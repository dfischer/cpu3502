'use strict';

const CPU = require('./3502');
const {TRITS_PER_TRYTE, TRYTES_PER_WORD, TRITS_PER_WORD, MAX_TRYTE, MIN_TRYTE, MEMORY_SIZE} = require('./arch');
const {get_trit, set_trit, slice_trits} = require('trit-getset');
const Triterm = require('tritmapped-terminal');
const isInteger = require('is-integer');

// 4 trits in each dimension, xxxx and yyyy
const VIDEO_TRYTE_COUNT = 4;

// '00xxx xyyyy' address -> 'xxxxx' tritmap value
const VIDEO_ADDRESS_SIZE = (3**VIDEO_TRYTE_COUNT * TRITS_PER_TRYTE)**TRYTES_PER_WORD / TRITS_PER_TRYTE;

const Memory = require('./memory');

const MAX_ADDRESS = (3**TRITS_PER_WORD - 1) / 2;
const MIN_ADDRESS = -MAX_ADDRESS;

const VIDEO_ADDRESS_OFFSET = MAX_ADDRESS - VIDEO_ADDRESS_SIZE; // -3281
if (VIDEO_ADDRESS_SIZE + VIDEO_ADDRESS_OFFSET !== MAX_ADDRESS) throw new Error('wrong video address size');

const CHARGEN_ADDRESS = -3282; // 0i111 11110
const CURSOR_ROW_ADDRESS = -3283;
const CURSOR_COL_ADDRESS = -3284;

const TIMER_FREQUENCY_ADDRESS = -3285;

const INT_VECTOR_N_ADDRESS = -29524; const INT_INPUT = -1;
const INT_VECTOR_Z_ADDRESS = -29522; const INT_START = 0;
const INT_VECTOR_P_ADDRESS = -29520; const INT_PULSE = 1;

const CODE_START_ADDRESS = -29518;

const memory = Memory({
  tryteCount: MEMORY_SIZE,
  map: {
    video: {
      start: VIDEO_ADDRESS_OFFSET,                      // -3281      0i111 11111
      end: VIDEO_ADDRESS_SIZE + VIDEO_ADDRESS_OFFSET,   // 29524, end 11111 11111
    },
    chargen: {
      start: CHARGEN_ADDRESS,
      end: CHARGEN_ADDRESS,
    },
    timer: {
      start: TIMER_FREQUENCY_ADDRESS,
      end: TIMER_FREQUENCY_ADDRESS,
    },
  }
});

console.log('memory.map',memory.map);

const term = Triterm({
  addressTryteSize: VIDEO_TRYTE_COUNT,
  tritmap: memory.subarray(memory.map.video.start, memory.map.video.end),
  handleInput: (tt, ev) => {
    if (isInteger(tt)) {
      cpu.interrupt(INT_INPUT, tt);
    }
  },
});

memory.map.video.write = (address, value) => {
  // When writing to video, refresh the terminal canvas
  // TODO: optimize to throttle refresh? refresh rate 60 Hz?/requestAnimationFrame? dirty, only if changes?
  //console.log('video write:',address,value);
  term.tc.refresh();
};

memory.map.chargen.write = (address, value) => {
  console.log('chargen',value);

  var row = memory.read(CURSOR_ROW_ADDRESS);
  var col = memory.read(CURSOR_COL_ADDRESS);

  // wrap-around if row/col out of terminal range
  row %= term.rowCount; if (row < 0) row += term.rowCount;
  col %= term.colCount; if (col < 0) col += term.colCount;

  console.log('COLROW',col,row);

  term.setTTChar(value, col, row);
  // TODO: write to row,col from another memory address value (no trap needed). -3282, -3283? - for cursor
};

const cpu = CPU({
  memory: memory
});

let _timer;
memory.map.timer.write = (address, value) => {
  function fire() {
    let ms = memory.read(TIMER_FREQUENCY_ADDRESS) * 100;
    if (ms < 100) ms = 100;

    console.log(`TIMER FIRE, next=${ms} ms`);
    cpu.interrupt(INT_PULSE); // TODO: pass dt, time since previous fire?

    _timer = window.setTimeout(fire, ms);
  };

  if (_timer === undefined) fire();
};


global.cpu = cpu;

const assembler = require('./as');

var lines = [
    '.org '+CODE_START_ADDRESS,
    'LDA #$ijk',
    'LDA #%ii1i0',
    'LDA #&QF',
    'NOP A',
    'NOP #-121',
    'NOP 29524',
    'LDA #0',
    'BNE #-1',
    'BEQ #+2',
    'HALTN',
    'HALTP',
    'LDA #42',
    'STA 0',

    'LDA #%00i01',
    'PTI A',

    'TAX',

    'LDA #%1111i',    // trit-text 'X'

    '.equ -3282 chargen',
    '.equ -3283 row',
    '.equ -3284 col',

    'STA chargen',

    'LDX #1',
    'STX col',
    'STA chargen',

    'LDX #1',
    'STX row',
    'LDX #2',
    'STX col',
    'STA chargen',

    'LDX #-1',
    'STX row',
    'STA chargen',


    'LDX #0',
    'STX row',
    'LDY #4',
    'STY col',
    'LDX #1',
    'STA chargen',

    'ADC #2',
    'NOT A',
    'STA chargen',  // trit-text red 'Z'

    'LDX #4',
    'INX',
    'STX col',
    'DEC chargen',  // trit-text 'Y'

    'TXA',  // X->A, 5

    // loop 6..19
    'loop:',
    'INC A',
    'STA col',
    'STA chargen',
    'CMP #20',
    //'BNE #-11',
    'BNE loop',

    'LDA #1',
    'STA row',
    'LDA #0',
    'STA col',

    // set input interrupt handler
    '.equ -29524 int_inputL',
    '.equ -29523 int_inputH',
    'LDA #handle_input.low',
    'STA int_inputL',
    'LDA #handle_input.high',
    'STA int_inputH',

    'SEIP', // enable interrupt -1 (keyboard input) TODO: also handle int 1, then can unmask all with CLI

    // set pulse interrupt handler
    '.equ -29520 int_pulseL',
    '.equ -29519 int_pulseH',
    'LDA #handle_pulse.low',
    'STA int_pulseL',
    'LDA #handle_pulse.high',
    'STA int_pulseH',

    'CLI',  // enable all interrupts

    '.equ -3285 timer_freq',
    'LDA #1', // 100 ms
    'STA timer_freq',

    'HALTZ',

    'handle_pulse:',
    // TODO: blinking cursor
    'INC chargen',
    'HALTZ',


    // advance terminal to next line
    'next_line:',
    'INC row',
    'LDA #0',
    'STA col',
    'HALTZ',       // TODO: RTI? return from interrupt

    'prev_line:',
    'DEC row',
    'LDA #44',    // TODO: .equ
    'STA col',
    'HALTZ',

    'backspace:',
    'DEC col',
    'LDA col',
    'CMP #-1',
    'BEQ prev_line',
    'LDA #0',     // null to erase TODO: space?
    'STA chargen',
    'HALTZ',

    // interrupt handler:
    'handle_input:',
    'CMP #12',        // trit-text newline
    'BEQ next_line',
    'CMP #0',
    'BEQ backspace',
    'STA chargen',
    'INC col',
    'LDX col',
    '.equ 46 row_count', // TODO: > instead of =
    'CPX #row_count',
    'BEQ next_line',  // TODO: support unresolved forward references in relative labels, offsets..
    'HALTZ',
];

cpu.memory.writeArray(CODE_START_ADDRESS, assembler(lines));
cpu.memory.write(INT_VECTOR_Z_ADDRESS, slice_trits(CODE_START_ADDRESS, 0, 5));
cpu.memory.write(INT_VECTOR_Z_ADDRESS + 1, slice_trits(CODE_START_ADDRESS, 5, 10));

//cpu.pc = cpu.read_int_vector(0);
//cpu.run();

cpu.interrupt(INT_START);

