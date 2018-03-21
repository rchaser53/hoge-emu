import { HelloOpecodesMap, Order } from './opecode'

export interface StatusRegister {  
  C: boolean
  Z: boolean
  I: boolean
  D: false
  B: boolean
  R: true
  O: boolean
  N: boolean
}

export interface Register {
  A: number,
  X: number,
  Y: number,
  S: number
  P: StatusRegister,
  PC: number
}

const DefaultStatusRegister: StatusRegister = {
  C: false,         // carry flag 
  Z: false,         // zero flag
  I: false,         // interupt? irq 0: enable irq, 1: ban irq
  D: false,         // decimal mode not implements
  B: false,         // breakMode set when BRK happen, clear IRQ happen
  R: true,          // NOTHING
  O: false,         // overflow P演算結果がオーバーフローを起こした時にセット
  N: false          // negative 演算結果のbit7が1の時にセット
}

export const DefualtRegister: Register = {
  A: 0x00,                    // Accumulator      8bit
  X: 0x00,                    // IndexesX         8bit
  Y: 0x00,                    // IndexesY         8bit
  S: 0x00,                    // Stack Pointer    8bit
  P: DefaultStatusRegister,   // Status Register  8bit
  PC: 0x00                    // Program Count    16bit
}

export class CPU {
  register: Register
  constructor() {
    this.register = DefualtRegister
  }

  load() {
    // return HelloOpecodesMap[byte]
  }

  run(opecode) {
    const order = this.fetch(opecode)
    this.register.PC += order.len
    this.executeOpeCode(order)
  }

  fetch(opecode: number): Order {
    const opeObject = HelloOpecodesMap[opecode.toString(16)];
    if (opeObject == null) {
      throw new Error(`${opecode} is not correct code or not implementation.`)
    }
    
    return opeObject
  }

  executeOpeCode(order: Order) {
    console.log(order)
    switch (order.opecode) {
      case 'SEI':
        this.register.P.I = false
        break;

      case 'SEC':
        this.register.P.C = true
        break;

      case 'LDA':

        break;

      case 'LDX':
        break;
      case 'LDY':
        break;

      case 'TXS':
        break;
      case 'TYA':
        break;

      case 'STA':
        break;
      case 'STX':
        break;

      case 'BNE':
        break;
      case 'BPL':
        break;
      case 'BCS':
        break;
      case 'BEQ':
        break;
      case 'BCC':
        break;

      case 'ADC':
        break;
      case 'DEC':
        break;
      case 'DEY':
        break;
      case 'INC':
        break;

      case 'RTS':
        break;

      case 'EOR':
        break;

      case 'JMP':
        break;
      case 'JSR':
        break;

      case 'CMP':
        break;

      case 'TAY':
        break;
      case 'CLC':
        break;

    }
  }

  // TODO
  reset() {

  }
}
