DMAは通常、VBlank中に行われる。

DMAはWRAMからPPU内部のスプライトRAMへ256バイトのデータを転送します。 DMAはCPUから$4014への書き込みによって開始し、 転送元の開始アドレスは$4014に書き込まれたデータを上位バイト、 下位バイトを$00とします。 DMAはアドレスをインクリメントしながら、データの読み込み、 書き込みを行うためCPU周期で514クロック要します。 この間、CPUは停止します。