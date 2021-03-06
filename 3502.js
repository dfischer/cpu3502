'use strict';

const {bts2n, n2bts, N_TO_BT_DIGIT, BT_DIGIT_TO_N} = require('balanced-ternary');
const {get_trit, set_trit, slice_trits} = require('trit-getset');
const {high_tryte, low_tryte} = require('./word.js');
const ttToUnicode = require('trit-text').toUnicode;

const {TRITS_PER_TRYTE, TRYTES_PER_WORD, TRITS_PER_WORD, MAX_TRYTE, MIN_TRYTE, MEMORY_SIZE} = require('./arch');

const {OP, ADDR_MODE, XOP, XOP_TO_ALU_OP} = require('./opcodes');

const {decode_instruction, decode_operand, disasm1} = require('./instr_decode');
const ALU = require('./alu');
const Memory = require('./memory');
const Flags = require('./flags');
const execute_xop_instruction = require('./xop');
const Stack = require('./stack');

const Assembler = require('./as').Assembler;

const INT_START = 0;

class CPU {
  constructor(opts={}) {
    this.memory = opts.memory || Memory({
      tryteCount: MEMORY_SIZE,
      map: opts.memoryMap || {}
    });
    this.pc = 0;
    this.accum = 0;
    this.index = 0;
    this.yindex = 0;
    this.flags = Flags();
    this.stack = Stack(this.memory);
    this.alu = ALU(this);
    this.dnop_throws_enabled = true;

    this.flags.I = -1; // by default only allow int 0, non-maskable NMI/start

    console.log('initial flags=',n2bts(this.flags));
  }

  // Assemble assembly for booting, write and setup boot interrupt vector
  assemble_bootcode(lines) {
    const CODE_START_ADDRESS = this.code_start_address();

    const a = new Assembler();
    a.origin = CODE_START_ADDRESS;

    const machine_code = a.assemble(lines);
    this.memory.writeArray(CODE_START_ADDRESS, machine_code);
    this.write_int_vector(INT_START, CODE_START_ADDRESS);

    return machine_code;
  }

  boot() {
    this.interrupt(INT_START);
  }

  state_snapshot() {
    return {
      pc: this.pc,
      accum: this.accum,
      index: this.index,
      yindex: this.yindex,
      stackptr: this.stack.stackptr,
      flags: this.flags
    };
  }

  state_restore(state) {
    this.pc = state.pc;
    this.accum = state.accum;
    this.index = state.index;
    this.yindex = state.yindex;
    this.stack.stackptr = state.stackptr;
    this.flags = state.flags;
  }

  write_int_vector(intnum, value) {
    this.memory.writeWord(this.vector_address(intnum), value);
  }

  // Get interrupt vector table address at negative-most memory, word addresses pointers (with 10-trit memory):
  // iiiii iiiii -29524 int -1
  // iiiii iiii0 -29523
  //
  // iiiii iiii1 -29522 int 0
  // iiiii iii0i -29521
  //
  // iiiii iii00 -29520 int +1
  // iiiii iii01 -29519
  vector_address(intnum) {
    return this.memory.minAddress + ((intnum + 1) * TRYTES_PER_WORD);
  }

  // Bootcode starts in low memory right after the three interrupt vectors
  code_start_address() {
    const ints = 3; // -1,0,1
    return this.memory.minAddress + ints * TRYTES_PER_WORD;
  }

  read_int_vector(intnum) {
    return this.memory.readWord(this.vector_address(intnum));
  }

  is_interrupt_allowed(intnum) {
    switch(this.flags.I) {
      case -1:
        // I=-1 allow only nonmaskable NMI interrupt 0 (start) (SEIN) (default)
        return intnum === 0;

      case 0:
        // I=0 allow all interrupts (CLI)
        return true;

      case 1:
        // I=1 allow interrupts -1 and 0, but mask 1 (SEIP)
        return intnum !== 1;
    }
  }

  interrupt(intnum, value) {
    console.log('interrupt',intnum,value);
    if (!this.is_interrupt_allowed(intnum)) {
      console.log(`interrupt ${intnum} masked by I=${this.flags.I}`);
      return;
    }

    const before = this.state_snapshot();

    const address = this.read_int_vector(intnum);
    console.log('interrupt vector address',address);

    if (address === 0) { // probably wrong
      debugger;
      throw new Error(`unset interrupt vector for ${intnum}`);
    }

    // Set accumulator to passed in value, used to send data from I/O
    // TODO: other registers? index, yindex, flags; optional. Or at least clear
    if (value !== undefined) this.accum = value;

    // Execute interrupt handler
    this.pc = address;
    this.run();

    // Restore previous state, except NMI/start interrupt, since it can set flags for other interrupt handlers
    if (intnum !== 0) this.state_restore(before);
  }

  execute_branch_instruction(flag, compare, direction, rel_address) {
    console.log(`compare flag=${flag}, direction=${direction}, compare=${compare}`);

    // compare (b) trit to compare flag with
    const flag_value = this.flags.get_flag(flag);

    // direction (c)
    // i less than (flag < trit)
    // 0 equal (flag = trit)
    // 1 not equal (flag != trit)
    let branch_taken = false;
    if (direction === -1) {
      branch_taken = flag_value < compare;
    } else if (direction === 0) {
      branch_taken = flag_value === compare;
    } else if (direction === 1) {
      branch_taken = flag_value !== compare;
    }

    console.log(`flag flag_value=${flag_value}, branch_taken=${branch_taken}, rel_address=${rel_address}`);

    // if matches, relative branch (+/- 121)
    if (branch_taken) {
      console.log('taking branch from',this.pc,'to',this.pc+rel_address);
      this.pc += rel_address;
    } else {
      console.log('not taking branch from',this.pc,'to',this.pc+rel_address);
    }
  }

  // Read instruction operand from decoded instruction, return read/write accessors
  read_alu_operand(di) {
    let read_arg, write_arg, address_of_arg;

    let decoded_operand = decode_operand(di, this.memory.subarray(this.pc), 0);

    this.pc += decoded_operand.consumed * this.flags.R;

    switch(decoded_operand.addressing_mode) {
      case ADDR_MODE.ABSOLUTE:
        // absolute, 2-tryte address
        console.log('absolute',decoded_operand.value);

        read_arg = () => { return this.memory.read(decoded_operand.value); };
        write_arg = (value) => { return this.memory.write(decoded_operand.value, value); };
        address_of_arg = () => { return decoded_operand.value; };

        break;

      case ADDR_MODE.ABSOLUTE_X:
        console.log('absolute,x',decoded_operand.value);

        read_arg = () => { return this.memory.read(decoded_operand.value + this.index); };
        write_arg = (value) => { return this.memory.write(decoded_operand.value + this.index, value); };
        address_of_arg = () => { return decoded_operand.value + this.index; };

        break;

      case ADDR_MODE.ABSOLUTE_Y:
        console.log('absolute,y',decoded_operand.value);

        read_arg = () => { return this.memory.read(decoded_operand.value + this.yindex); };
        write_arg = (value) => { return this.memory.write(decoded_operand.value + this.yindex, value); };
        address_of_arg = () => { return decoded_operand.value + this.yindex; };

        break;


      case ADDR_MODE.ACCUMULATOR:
        // accumulator, register, no arguments
        read_arg = () => { return this.accum; };
        write_arg = (value) => { return (this.accum = value); };
        address_of_arg = () => { throw new Error(`cannot take address of accumulator, in instruction ${JSON.stringify(di)} at pc=${this.pc}`); };

        console.log('accum');

        break;

      case ADDR_MODE.IMMEDIATE:
        // immediate, 1-tryte literal
        console.log('immediate',decoded_operand.value);

        read_arg = () => { return decoded_operand.value; };
        write_arg = () => { throw new Error(`cannot write to immediate: ${decoded_operand.value}, in instruction ${JSON.stringify(di)} at pc=${this.pc}`); };
        address_of_arg = () => { throw new Error(`cannot take address of immediate operand, in instruction ${JSON.stringify(di)} at pc=${this.pc}`); }; // actually, maybe can (code_offset)

        break;

      case ADDR_MODE.INDIRECT_INDEXED_Y:
        console.log('indirect_indexed',decoded_operand.value);

        address_of_arg = () => {
          // (indirect),Y
          let ptr = this.memory.readWord(decoded_operand.value);
          ptr += this.yindex;
          return ptr;
        };

        read_arg = () => { return this.memory.read(address_of_arg()); };
        write_arg = (value) => { return this.memory.write(address_of_arg(), value); }

        break;

      case ADDR_MODE.INDIRECT:
        console.log('indirect',decoded_operand.value);

        // (indirect)
        address_of_arg = () => { return this.memory.readWord(decoded_operand.value); };
        read_arg = () => { return this.memory.read(address_of_arg()); };
        write_arg = (value) => { return this.memory.write(address_of_arg(), value); }

        break;

      default:
        read_arg = write_arg = address_of_arg = () => { throw new Error(`unimplemented addressing mode ${decoded_operand.addressing_mode}, in decoded=operand${JSON.stringify(di)}`); }

    }

    return {read_arg, write_arg, address_of_arg};
  }

  step() {
    const opcode = this.memory.read(this.pc);
    console.log('\npc=',this.pc,' opcode=',opcode,'disasm=',disasm1(this.memory.subarray(this.pc)).asm);

    if (opcode === undefined) {
      // increase MEMORY_SIZE if running out too often
      throw new Error('program counter '+this.pc+' out of range into undefined memory');
    }
    if (opcode > MAX_TRYTE || opcode < MIN_TRYTE) {
      // indicates internal error in simulator, backing store shouldn't be written out of this range
      throw new Error('memory at pc='+this.pc+' value='+opcode+' out of 5-trit range');
    }

    const di = decode_instruction(opcode);

    if (di.family === 0) {
      let {read_arg, write_arg, address_of_arg} = this.read_alu_operand(di);

      this.alu.execute_alu_instruction(di.operation, read_arg, write_arg);
    } else if (di.family === 1) {
      const rel_address = this.memory.read(this.pc += this.flags.R);

      this.execute_branch_instruction(di.flag, di.compare, di.direction, rel_address);
    } else if (di.family === -1) {
      let {read_arg, write_arg, address_of_arg} = this.read_alu_operand(di);

      if (XOP_TO_ALU_OP[di.operation] !== undefined) {
        // alu operation, extended addressing mode in xop namespace
        const alu_op = XOP_TO_ALU_OP[di.operation];
        this.alu.execute_alu_instruction(alu_op, read_arg, write_arg);
      } else {
        execute_xop_instruction(this, di.operation, read_arg, write_arg, address_of_arg);
      }
    }

    console.log('flags:','RHUVSDCIL');
    console.log('flags:',n2bts(this.flags.value), `A=${this.accum}(${ttToUnicode(this.accum)}), X=${this.index}, Y=${this.yindex}`);
    this.pc += this.flags.R;
  }

  run() {
    this.flags.R = 1; // running: 1, program counter increments by; -1 runs backwards, 0 halts
    do {
      this.step();
    } while(this.flags.R !== 0);
    console.log('Halted with status',this.flags.H);
  }
}

module.exports = function(opts) {
  return new CPU(opts);
};

