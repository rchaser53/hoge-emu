import { convertIndexToRowColumn, createColorTileDef, createSpriteInputs, createBaseArrays } from './util'

// 0x2000 - 0x2007
export interface PPURegister {
  PPUCTRL: number // コントロールレジスタ1	割り込みなどPPUの設定
  PPUMASK: number // コントロールレジスタ2	背景 enableなどのPPU設定
  PPUSTATUS: number // ppu status
  OAMADDR: number // スプライトメモリデータ	書き込むスプライト領域のアドレス
  OAMDATA: number // デシマルモード	スプライト領域のデータ
  PPUSCROLL: number // 背景スクロールオフセット	背景スクロール値
  PPUADDR: number // PPUメモリアドレス	書き込むPPUメモリ領域のアドレス
  PPUDATA: number // PPUメモリデータ	PPUメモリ領域のデータ
}

export interface VramAddressInfo {
  key: string
  address: number
  index: number
}

export interface SpriteInfo {
  x: number,
  y: number,
  patternIndex: number,
  attribute: number,
  drawInfo: number[][]
}

const PPURegisterMap = {
  0: 'PPUCTRL',
  1: 'PPUMASK',
  2: 'PPUSTATUS',
  3: 'OAMADDR',
  4: 'OAMDATA',
  5: 'PPUSCROLL',
  6: 'PPUADDR',
  7: 'PPUDATA'
}

const PreRenderLine = 8;
const LineLimit = 261
const VBlankLine = 241;
// const BoarderCycle = 341;
// const SpriteNumber = 100;

const DefaultPPUMASK = 0b00000000;
const DefaultPPUCTRL = 0b01000000;

const SpriteStartBottomBit = 0b10000000
const SpriteStartRightBit = 0b1000000
const PreferentialBackgroundBit = 0b100000

export class PPU {
  cycle: number = 0
  line: number = 0
  background: any[] = []
  tileY: number
  sprites: any[] = []
  spriteRamAddr: number = 0
  vRamAddr: number = 0
  vRamBaffer: number = 0x00
  isVramAddrUpper: boolean = true

  characteSpriteData: number[][]
  spriteRam: Uint8Array = new Uint8Array(0x100)

  patternTables: Uint8Array[] = [
    new Uint8Array(0x1000),
    new Uint8Array(0x1000)
  ];

  nameTables: Uint8Array[] = [
    new Uint8Array(0x3c0),
    new Uint8Array(0x3c0),
    new Uint8Array(0x3c0),
    new Uint8Array(0x3c0)
  ];

  attributeTables: Uint8Array[] = [
    new Uint8Array(0x40),
    new Uint8Array(0x40),
    new Uint8Array(0x40),
    new Uint8Array(0x40)
  ];

  nameAttributeMirror: Uint8Array = new Uint8Array(0xeff) //  $3000～$3EFF
  backgroundPalette: Uint8Array = new Uint8Array(0x10) //  $3F00～$3F0F
  spritePalette: Uint8Array = new Uint8Array(0x10) //  $3F10～$3F1F
  paletteMirror: Uint8Array = new Uint8Array(0xd0) //  $3F20～$3FFF

  colorTileBuffer: number[][] = []

  register: PPURegister = {
    PPUCTRL: DefaultPPUCTRL,
    PPUMASK: DefaultPPUMASK,
    PPUSTATUS: 0x00,
    OAMADDR: 0x00,
    OAMDATA: 0x00,
    PPUSCROLL: 0x00,
    PPUADDR: 0x0000,
    PPUDATA: 0x00
  }

  constructor(characterROM: any) {
    const sprites: any = []
    const characterArray = Array.from(characterROM)
    while (characterArray.length !== 0) {
      sprites.push(characterArray.splice(0, 16))
    }
    this.characteSpriteData = sprites
  }

  get offsetCharacteSpriteData() {
    const SpriteBaseBinary = 0b1000;
    return (this.register.PPUCTRL & SpriteBaseBinary) === SpriteBaseBinary
              ? 0x1000 / 16
              : 0
  }

  read(index: number): number {
    switch (PPURegisterMap[index]) {
      case 'PPUSTATUS':
        return this.register.PPUSTATUS
      case 'PPUDATA':
        let ret;
        const { key, address, index } = this.getTargetVram()
        switch (key) {
          case 'patternTables':
          case 'nameTables':
          case 'attributeTables':
            ret = this[key][index][address]
            break;
          default:
            ret = this[key][address]
            break;
        }
        this.moveNextVramAddr()
        return ret
      default:
        break
    }
    throw new Error(`should not come here! ${this}`)
  }

  write(index: number, value: number) {
    // console.log(index, value)
    switch (PPURegisterMap[index]) {
      case 'PPUCTRL':
        this.register.PPUCTRL = value;
        break
      case 'PPUMASK':
        this.register.PPUMASK = value;
        break
      case 'OAMADDR':
        this.spriteRamAddr = value
        break
      case 'OAMDATA':
        this.spriteRam[this.spriteRamAddr] = value
        this.spriteRamAddr++
        break
      case 'PPUADDR':
        this.writeVRamAddress(value)
        break
      case 'PPUDATA':
        this.writePpuData(value)
        this.moveNextVramAddr()
        break
      case 'PPUSTATUS':
      case 'PPUSCROLL':
        this.register[PPURegisterMap[index]] = value
        break
      default:
        throw new Error(`should not come ${this}`)
    }
  }

  writePpuData(value: number) {
    const { key, address, index } = this.getTargetVram()
    // Addresses $3F10/$3F14/$3F18/$3F1C are mirrors of $3F00/$3F04/$3F08/$3F0C
    // Note that this goes for writing as well as reading
    if (key === 'spritePalette') {
      if ((address === 0x00) || (address === 0x04) || (address === 0x08) || (address === 0x0c)) {
        this.backgroundPalette[address] = value
        return
      }
    }

    switch (key) {
      case 'patternTables':
      case 'nameTables':
      case 'attributeTables':
        this[key][index][address] = value
        break;
      default:
        this[key][address] = value
        break;
    }
  }

  getTargetVram(): VramAddressInfo {
    const address = this.vRamAddr
    if (address < 0x1000) {
      return { key: 'patternTables', index: 0, address }
    } else if (address < 0x2000) {
      return { key: 'patternTables', index: 1, address: address - 0x1000 }
    } else if (address < 0x23c0) {
      return { key: 'nameTables', index: 0, address: address - 0x2000 }
    } else if (address < 0x2400) {
      return { key: 'attributeTables', index: 0, address: address - 0x23c0 }
    } else if (address < 0x27c0) {
      return { key: 'nameTables', index: 1, address: address - 0x2400 }
    } else if (address < 0x2800) {
      return { key: 'attributeTables', index: 1, address: address - 0x27c0 }
    } else if (address < 0x2bc0) {
      return { key: 'nameTables', index: 2, address: address - 0x2800 }
    } else if (address < 0x2c00) {
      return { key: 'attributeTables', index: 2, address: address - 0x2bc0 }
    } else if (address < 0x2fc0) {
      return { key: 'nameTables', index: 3, address: address - 0x2c00 }
    } else if (address < 0x3000) {
      return { key: 'attributeTables', index: 3, address: address - 0x2fc0 }
    } else if (address < 0x3f00) {
      return { key: 'nameAttributeMirror', index: 0, address: address - 0x3000 }
    } else if (address < 0x3f10) {
      return { key: 'backgroundPalette', index: 0, address: address - 0x3f00 }
    } else if (address < 0x3f20) {
      return { key: 'spritePalette', index: 0, address: address - 0x3f10 }
    } else if (address < 0x4000) {
      return { key: 'paletteMirror', index: 0, address: address - 0x3f20 }
    }
    throw new Error(`address '${address}' is too big {address}`)
  }

  moveNextVramAddr() {
    const AddressIncrementalModeBinary =  0b100;
    this.vRamAddr += (this.register.PPUCTRL & AddressIncrementalModeBinary) === AddressIncrementalModeBinary
                      ? 32 : 1
  }

  writeVRamAddress(value: number) {
    if (this.isVramAddrUpper === true) {
      this.vRamBaffer = value
    } else {
      this.vRamAddr = (this.vRamBaffer << 8) | value
    }
    this.isVramAddrUpper = !this.isVramAddrUpper
  }

  getNameSpace(): number {
    const nameTableBinaries = 0b11;
    const base = this.register.PPUCTRL & nameTableBinaries;

    return 0x2000 + (base * 0x400)
  }

  get currentAttributeTable() {
    const nameTableBinaries = 0b11;
    return this.attributeTables[this.register.PPUCTRL & nameTableBinaries] as any;
  }

  get currentNameTable() {
    const nameTableBinaries = 0b11;
    return Array.from(this.nameTables[this.register.PPUCTRL & nameTableBinaries]);
  }
  
  run(cycle: number) {
    this.cycle += cycle
    this.line++

    if (this.line === LineLimit) {
      this.colorTileBuffer = createColorTileDef(this.currentAttributeTable)
      this.line = 0
      this.register.PPUSTATUS ^= 0x80;

      return {
        sprites: this.buildSprites(),
        background: this.buildBackground()
      }
    }

    if (this.line === VBlankLine) {
      this.register.PPUSTATUS |= 0x80;
      // if (this.register.PPUCTRL.isEnableNmi === true) {}
    }

    return
  }

  buildSprites() {
    const sprites: any[] = []
    const inputRam: number[] = Array.from(this.spriteRam)
    while (inputRam.length !== 0) {
      sprites.push(inputRam.splice(0, 4))
    }

    return sprites.map((sprite: number[]) => {
      const upperColorBits = (sprite[2] >> 1) & 0b11
      const patternIndex = sprite[1] + this.offsetCharacteSpriteData
      return {
        x: sprite[3],
        y: sprite[0] - PreRenderLine,
        patternIndex,
        attribute: sprite[2],
        drawInfo: this.createSpliteDrawInfo(patternIndex, upperColorBits, sprite[2]),
      }
    });
  }

  useBackgroundPalette(index: number, useBackground: boolean): boolean {
    return useBackground || (index === 0x00) || (index === 0x04) || (index === 0x08) || (index === 0x0c)
  }

  createSpliteDrawInfo(spriteIndex: number, upperColorBits: number, attribute: number) {
    const sprite = createSpriteInputs(this.characteSpriteData[spriteIndex])
    const retSprites = createBaseArrays()
    const startTop = ((attribute & SpriteStartBottomBit) === SpriteStartBottomBit) === false
    const startLeft = ((attribute & SpriteStartRightBit) === SpriteStartRightBit) === false
    const useBackground = ((attribute & PreferentialBackgroundBit) === PreferentialBackgroundBit)

    for (let row = 0; row < 8; row++) {
      for (let column = 0; column < 8; column++) {
        const actualRow = startTop ? row : 7 - row;
        const actualColumn = startLeft ? 7 - column : column;

        const paletteIndex = (upperColorBits << 2) | sprite[row][column]
        retSprites[actualRow][actualColumn] = (this.useBackgroundPalette(paletteIndex, useBackground))
                                                  ? this.backgroundPalette[paletteIndex]
                                                  : this.spritePalette[paletteIndex]
      }
    }
    return retSprites
  }

  buildBackground() {
    return this.currentNameTable.map((elem, index) => {
      return this.createBackgroundSprite(elem, index)
    })
  }

  createBackgroundSprite(characterIndex: number, nameIndex: number) {
    const { row, column } = convertIndexToRowColumn(nameIndex)
    const sprite = createSpriteInputs(this.characteSpriteData[characterIndex])

    return sprite.map((elem) => {
      return elem
        .map((num) => {
          const base = (this.colorTileBuffer[row][column] << 2) | num
          const paletteIndex = (base === 0x04) || (base === 0x08) || (base === 0x0c)
                                  ? 0x00
                                  : base;
          return this.backgroundPalette[paletteIndex]
        })
        .reverse()
    })
  }
}
// Initial Register Values
// Register	                          At Power	              After Reset
// PPUCTRL ($2000)	                    0000 0000	              0000 0000
// PPUMASK ($2001)	                    0000 0000	              0000 0000
// PPUSTATUS ($2002)	                  +0+x xxxx	              U??x xxxx
// OAMADDR ($2003)	                    $00	                    unchanged1
// $2005 / $2006 latch	                cleared	                cleared
// PPUSCROLL ($2005)	                  $0000	                  $0000
// PPUADDR ($2006)	                    $0000	                  unchanged
// PPUDATA ($2007) read buffer	        $00	                    $00
// odd frame	                          no	                    no
// OAM	                                pattern	                pattern
// NT RAM (external, in Control Deck)	  mostly $FF	            unchanged
// CHR RAM (external, in Game Pak)	    unspecified pattern	    unchanged

// 描画されるべきスプライトのために、 スプライトテンポラリレジスタとスプライトバッファレジスタが8スプライト分だけ存在します。 あるラインにおいて次のラインで描画されるべきスプライトが見つかった場合、 スプライトテンポラリレジスタに保持されます。 スプライトの探索の後、 スプライトテンポラリレジスタに基づいてスプライトバッファレジスタにスプライトのパターンがフェッチされます。 このパターンデータが次のラインで描画されます。 またスプライト用レジスタの最初のスプライトはスプライト#0と呼ばれます。 このスプライトがBG上に描画されるピクセルにおいて、ヒットフラグがセットされます。 このヒットフラグの利用例として横スクロールゲームなどでは、 ヒットするまでは横スクロール値を0として点数やタイムなどの情報を描画し、 ヒットが検出されたら横スクロール値を設定してスクロールしたゲーム画面を描画しています。


// export interface ControlRegister {
//   nameTableLowwer: boolean // 10(true, false): $2800, 11(true, true): $2C00
//   nameTableUpper: boolean // 00(false, false): $2000, 01(false, true): $2400
//   ppuAddressIncrementMode: boolean // false: +1, true: +32
//   isSpriteBase: boolean // false: $0000  true: $1000
//   isBgBase: boolean // false: $0000  true: $1000
//   isLargesprite: boolean // false: 8x8  true: 8x16
//   masterslabe: true // 常時true
//   isEnableNmi: boolean // false: 無効  true: 有効
// }

// export interface MaskRegister {
//   isDisplayMono: boolean // ディスプレイタイプ　0:カラー、1:モノクロ
//   backgroundMask: boolean // 背景マスク、画面左8ピクセルを描画しない。0:描画しない、1:描画
//   spriteMask: boolean // スプライトマスク、画面左8ピクセルを描画しない。0:描画しない、1:描画
//   isBackgroundEnable: boolean // 背景有効　0:無効、1:有効
//   isSpriteEnable: boolean // スプライト有効　0:無効、1:有効
//   bgColorFlag2: boolean // 背景色
//   bgColorFlag1: boolean // 000:黒, 001:緑
//   bgColorFlag0: boolean // 010:青, 100:赤
// }