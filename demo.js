'use strict';

const CPU = require('./3502');
const {TRITS_PER_TRYTE, TRYTES_PER_WORD, TRITS_PER_WORD, MAX_TRYTE, MIN_TRYTE, MEMORY_SIZE} = require('./arch');
const Triterm = require('tritmapped-terminal');

// 4 trits in each dimension, xxxx and yyyy
const VIDEO_TRYTE_COUNT = 4;

// '00xxx xyyyy' address -> 'xxxxx' tritmap value
const VIDEO_ADDRESS_SIZE = (3**VIDEO_TRYTE_COUNT * TRITS_PER_TRYTE)**TRYTES_PER_WORD / TRITS_PER_TRYTE;

const Memory = require('./memory');

const MAX_ADDRESS = (3**TRITS_PER_WORD - 1) / 2;
const MIN_ADDRESS = -MAX_ADDRESS;

const VIDEO_ADDRESS_OFFSET = MAX_ADDRESS - VIDEO_ADDRESS_SIZE; // -3280,
if (VIDEO_ADDRESS_SIZE + VIDEO_ADDRESS_OFFSET !== MAX_ADDRESS) throw new Error('wrong video address size');

const memory = Memory({
  tryteCount: MEMORY_SIZE,
  map: {
    video: {
      start: VIDEO_ADDRESS_OFFSET,                      // -3280      00iii iiiii
      end: VIDEO_ADDRESS_SIZE + VIDEO_ADDRESS_OFFSET,   // 29524, end 11111 11111
    },
    chargen: {
      start: -3281, // 0i111 11111,
      end: -3281,
    },
  }
});

console.log('memory.map',memory.map);

const term = Triterm({
  addressTryteSize: VIDEO_TRYTE_COUNT,
  tritmap: memory.subarray(memory.map.video.start, memory.map.video.end)
});

memory.map.video.write = (address, value) => {
  // When writing to video, refresh the terminal canvas
  // TODO: optimize to throttle refresh? refresh rate 60 Hz?/requestAnimationFrame? dirty, only if changes?
  //console.log('video write:',address,value);
  term.tc.refresh();
};

memory.map.chargen.write = (address, value) => {
  term.writeUChar(value);
  // TODO: write to row,col from another memory address value (no trap needed). -3282, -3283? - for cursor
};

const cpu = CPU({
  memory: memory
});
global.cpu = cpu;

const assembler = require('./as');

var lines = [
    'LDA #$ijk',
    'LDA #%ii1i0',
    'LDA #&QF',
    'NOP A',
    'NOP #-121',
    'NOP 29524',
    'LDA #0',
    'BNE -1',
    'BEQ +2',
    'HALT_N',
    'HALT_P',
    'LDA #42',
    'STA 0',

    'LDA #%00i01',
    'PTI A',

    'TAX',

    'STA -3281',

    'HALT_Z'
  ];

cpu.memory.writeArray(0, assembler(lines));

cpu.run();

