'use strict';

const {MAX_TRYTE, MIN_TRYTE, TRITS_PER_TRYTE} = require('./arch');
const {OP, ADDR_MODE, FLAGS, XOP} = require('./opcodes');
const {get_trit, slice_trits} = require('trit-getset');
const invertKv = require('invert-kv');

function decode_instruction(opcode) {
  const family = get_trit(opcode, 0);
  //console.log('family',family,n2bts(opcode));

  // 5-trit trytes
  // 43210
  // aaab0 aa=operation, b=addressing mode
  // aabc1 aa=flag, b=direction(i<, 0=,1!=), c=trit to compare with
  // aaaai other instructions

  if (family === 0) {
    const operation = slice_trits(opcode, 2, 5);
    const addressing_mode = get_trit(opcode, 1);

    return {family, operation, addressing_mode};
  } else if (family === 1) {
    const flag = slice_trits(opcode, 3, 5);
    const direction = get_trit(opcode, 2);
    const compare = get_trit(opcode, 1);

    return {family, flag, compare, direction};
  } else if (family === -1) {
    const operation = slice_trits(opcode, 1, 5);

    return {family, operation};
  }

  throw new Error('unable to decode instruction: '+op);
};

// Read operands from a decoded instruction start at machine_code[offset] (offset=opcode)
function decode_operand(di, machine_code, offset=0) {
  switch(di.addressing_mode) {
    // absolute, 2-tryte address
    case ADDR_MODE.ABSOLUTE:
      let absolute = machine_code[offset + 1];
      absolute += 3**TRITS_PER_TRYTE * machine_code[offset + 2]; // TODO: endian?

      return {absolute, consumed:2};

    // accumulator, register, no arguments
    case ADDR_MODE.ACCUMULATOR:
      return {accumulator:true, consumed:0};

    // immediate, 1-tryte literal
    case ADDR_MODE.IMMEDIATE:
      let immediate = machine_code[offset + 1];
      return {immediate, consumed:1};
  }

  // TODO: XOPs might have custom operands

  // No operands
  return {consumed:0};
}

// Disassemble one instruction in machine_code
function disasm(machine_code) {
  let di = decode_instruction(machine_code[0]);

  let opcode, operand;
  let consumed = 1; // 1-tryte opcode, incremented later if operands

  if (di.family === 0) {
    opcode = invertKv(OP)[di.operation]; // inefficient lookup, but probably doesn't matter

    // note: some duplication with cpu read_alu_operand TODO: factor out
    // TODO: handle reading beyond end
    let decoded_operand = decode_operand(di, machine_code, 0);

    if ('absolute' in decoded_operand) {
        operand = decoded_operand.absolute.toString(); // decimal address
        //operand = '%' + n2bts(absolute); // base 3 trits TODO: what base to defalt to? 3, 9, 27, 10??
    } else if ('accumulator' in decoded_operand) {
        operand = 'A';
    } else if ('immediate' in decoded_operand) {
        operand = '#' + '%' + n2bts(decoded_operand.immediate); // TODO: again, what base?
    }
    consumed += decoded_operand.consumed;
  } else if (di.family === 1) {
    opcode = 'BR';
    opcode += invertKv(FLAGS)[di.flag];
    // TODO
    opcode += {'-1':'L', 0:'E', 1:'N'}[di.direction];
    opcode += {'-1':'N', 0:'Z', 1:'P'}[di.compare];

    operand = machine_code[1].toString();
    if (machine_code[1] > 0) {
      // always add +, since makes relativity clearer
      operand = '+' + machine_code[1].toString();
    } else {
      operand = machine_code[1].toString();
    }

    consumed += 1;
  } else if (di.family === -1) {
    opcode = invertKv(XOP)[di.operation];
    // TODO: undefined opcodes
  }

  let asm;

  if (operand !== undefined) {
    asm = opcode + ' ' + operand;
  } else {
    asm = opcode;
  }

  return {asm, consumed};
}

module.exports = {
  decode_instruction,
  decode_operand,
  disasm,
};
