'use strict';

module.exports = {
  // shifts
  SHL: -13, // iii shift left (like ASL arithmetic shift left) = multiplication by power of three
  ROL: -12, // ii0 rotate left
  ROR: -11, // ii1 rotate right
  LSR: -10, // i0i shift right (logical) = division by by power of three

  // indexing
  STX: -9, // i00 store X
  LDX: -8, // i01 load X

  // ternary dyadic functions
  BUT: -7, // i1i pref-0i1, BUT                                f i0i,000,i01
  ORA: -6, // i10 pref-10i, TOR,  maximum, ↑ U+2191, ∨ U+2228, f i01,001,111
  AND: -5, // i11 pref-i01, TAND, minimum, ↓ U+2193, ∧ U+2227, f iii,i00,i01
  EOR: -4, // 0ii exclusive max ⇑ U+2d1                        f i01,0i1,11i

  CPX: -3, // 0i0 copy x
  TRI: -2, // 0i1 tritmask, like 6502 BIT

  // increment/no-op/decrement
  DEC: -1, // 00i decrement
  NOP: 0,  // 000 no operation
  INC: 1,  // 001 increment

  JMP: 2, // 01i jump

  // arithmetic
  ADC: 3, // 010 add with carry
  STA: 4, // 011 store accumulator
  LDA: 5, // 1ii load accumulator
  CMP: 6, // 1i0 compare
  SBC: 7, // 1i1 subtract borrow carry

  uu3: 8, // 10i
  uu4: 9, // 100
  uu5:10, // 101
  uu6:11, // 11i
  uu7:12, // 110
  uu8:13  // 111
};
