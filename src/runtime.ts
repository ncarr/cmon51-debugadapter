import { IDisposable, IPty, spawn } from 'node-pty'
import { join } from 'path'
import { env } from 'process'
import { parseLst } from './parselst'
import stripAnsi from 'strip-ansi'
import EventEmitter from 'events'

const CMON51_PATH = env.CMON51_PATH || 'C:\\CrossIDE\\cmon51.tcl'

type Matcher = SingleMatcher | MultiMatcher

interface SingleMatcher {
    pattern: RegExp
    resolve: (value: RegExpMatchArray) => void
    untilInteractive?: false
}

interface MultiMatcher {
    pattern: RegExp
    resolve: (value: RegExpMatchArray[]) => void
    matches: RegExpMatchArray[]
    untilInteractive: true
}

export interface Instruction {
    address: string
    instruction: string
    line: number
}

export interface Registers {
    a: string
    b: string
    sp: string
    ie: string
    dph: string
    dpl: string
    psw: string
    pc: string
    r0: string
    r1: string
    r2: string
    r3: string
    r4: string
    r5: string
    r6: string
    r7: string
    bank: string
    line: number
}

/**
 * Class to interface with CMON51 over the command line
 * 
 * Line numbers are indexed from 0
 */
export class Runtime extends EventEmitter {
    private process: IPty
    private matchers: Matcher[] = []
    private outputBuffer: string[] = []
    private lineMap: string[]
    private instructionList: number[]
    private dataListener: IDisposable
    private file: string

    private static interactive = /> /
    private static carriageReturn = /\r/

    /**
     * Start CMON51 and the command scheduler
     */
    async initialize() {
        // Start CMON51
        // Since it buffers its output until it exits when it is not in a
        // terminal, we need to run it in a pseudoterminal to interact in
        // real time
        this.process = spawn(
            join(env.QUARTUS_ROOTDIR, 'bin64/quartus_stp.exe'),
            ['-t', CMON51_PATH],
            {})
        // Schedule response matchers
        this.dataListener = this.process.onData((rawData) => {
            // Pass the output directly to the debug terminal
            this.emit('output', rawData)
            // Replace the control characters that move the cursor to the right with spaces
            // Remove all other control characters
            const data = stripAnsi(rawData.replace(/\x1B\[(\d)C/g, (_, spaces) => ' '.repeat(parseInt(spaces))))

            if (this.matchers.length > 0) {
                this.runNextMatcher(data)
            } else {
                this.outputBuffer.push(data)
            }
        })

        // Send a dummy command to test if it is accepting user input
        this.sendCommand('r')
        // Wait for it to be acknowledged before returning
        await this.matchResponse(/A =/, Runtime.interactive)
    }

    /**
     * Replace breakpoints
     * @param file Path to ASM file to set breakpoints in
     * @param lines Array of lines to break before
     */
    async setBreakpoints(file: string, lines: number[]) {
        this.file = file
        // Map line numbers to memory addresses
        this.lineMap = this.lineMap || await parseLst(file)
        this.instructionList = Array.from(new Set(this.lineMap)).map((address) => parseInt(address, 16))
        const addresses = lines
            .map((line) => line < this.lineMap.length
                            ? this.lineMap[line]
                            : this.lineMap[this.lineMap.length])

        // Clear breakpoints
        this.sendCommand('brc')

        // Set breakpoints for each address
        for (const address of addresses) {
            this.sendCommand('bron', address)
        }

        await this.matchResponse(...new Array(addresses.length + 1).fill(Runtime.interactive))

        return addresses.map((address) => this.lineMap.lastIndexOf(address))
    }

    /**
     * Starts or resumes the program until the next breakpoint
     * @returns Stack frame after the next breakpoint is hit
     */
    async continue() {
        // Start the program
        this.sendCommand('g')

        // Wait for a breakpoint to be hit before returning breakpoint info
        return this.parseRegisters()
    }

    /**
     * Send arbitrary input to CMON51
     * @param input CMON51 command to send
     */
    async evaluate(input: string) {
        this.sendCommand(input)
        await this.matchResponse(Runtime.interactive)
    }

    /**
     * Get current variable values
     * @returns Stack frame info
     */
    async variables() {
        this.sendCommand('r')
        return this.parseRegisters()
    }

    /**
     * List breakpoints
     * @returns List of line numbers where breakpoints are
     */
    async getBreakpoints() {
        this.sendCommand('brl')
        const matches = await this.matchUntilInteractive(/(?<breakpoint>[0-9A-F]+)/)
        return matches.map((match) => this.lineMap.lastIndexOf(match.groups.breakpoint))
    }

    /**
     * Step one instruction forward
     * @returns Stack frame info
     */
    async next() {
        this.sendCommand('s')
        return this.parseRegisters()
    }

    /**
     * Read the value of one register
     * @param register Register to read
     * @returns Data in register
     */
    async readVariable(register: string) {
        this.sendCommand(register)
        // Match either the data or the error message
        const [_, result] = await this.matchResponse(Runtime.carriageReturn, /(?<data>^[0-9A-F]+$)|(?:\r)/)
        if (result.groups.data) {
            return result.groups.data
        } else {
            throw result.input
        }
    }

    /**
     * Write a value to a register
     * @param register Register to write to
     * @param value Value to write
     */
    async setVariable(register: string, value: string) {
        this.sendCommand(`${register}=${value}`)
        await this.matchResponse(Runtime.interactive)
    }

    /**
     * Disassemble code
     * @param address Address to start disassembly
     * @param instructionCount Number of instructions to disassemble
     * @returns List of lines from the disassembly output
     */
    async disassemble(address: number, instructionCount: number, instructionOffset: number): Promise<Instruction[]> {
        // Map addresses to instructions, handling overflow and underflow
        const endAddress = this.instructionList[this.instructionList.length - 1]
        let baseInstr: number
        if (address < 0) {
            baseInstr = address
        } else if (address > endAddress) {
            baseInstr = this.instructionList.length - 1 + address - endAddress
        } else {
            baseInstr = this.instructionList.indexOf(address)
        }
        const startInstr = baseInstr + instructionOffset
        // Pad negative addresses with nop instructions
        let results: Instruction[] = []
        for (let i = startInstr; i < 0 && i < startInstr + instructionCount; i++) {
            results.push({
                address: i !== -1 ? i.toString(16) : '-1 ',
                instruction: '00        nop',
                line: -1
            })
        }
        // Only call the debugger if there is a possibility of hitting a real address
        let debuggerResults: RegExpMatchArray[] = []
        if (startInstr + instructionCount > 0) {
            let debuggerStartAddress: number
            let debuggerInstructionCount = instructionCount
            if (startInstr < 0) {
                debuggerStartAddress = 0
                debuggerInstructionCount = instructionCount + startInstr
            } else if (startInstr >= this.instructionList.length) {
                debuggerStartAddress = endAddress + startInstr - (this.instructionList.length - 1)
            } else {
                debuggerStartAddress = this.instructionList[startInstr]
            }
            this.sendCommand('u', debuggerStartAddress.toString(16), debuggerInstructionCount.toString(16))
            debuggerResults = await this.matchUntilInteractive(/(?<address>[0-9A-F]+): *(?<instruction>.+)/)
        }
        return [...results, ...debuggerResults.map(({ groups: { address, instruction }}) => ({
            address,
            instruction,
            line: parseInt(address, 16) <= endAddress ? this.lineMap.lastIndexOf(address) : -1
        }))]
    }

    /**
     * Attempt to end the debug session
     * @returns A promise that resolves or rejects depending on CMON51's exit code
     */
    async terminate() {
        this.sendCommand('exit')
        return new Promise<void>((resolve, reject) => {
            const exitListener = this.process.onExit(({ exitCode }) => {
                exitListener.dispose()
                this.dataListener.dispose()
                if (exitCode !== 0) {
                    reject(exitCode)
                } else {
                    resolve()
                }
            })
        })
    }

    /**
     * Forcefully end CMON51
     */
    disconnect() {
        this.process.kill()
        this.dataListener.dispose()
    }

    /**
     * Current file path
     * @returns Path to currently running file
     */
    getFile() {
        return this.file;
    }

    /**
     * Send a command to CMON51.
     * 
     * Ensure initialize is called first before calling this function
     * 
     * @param command Command to send
     * @param args Arguments to send
     */
    private sendCommand(command: string, ...args: string[]) {
        // Separate arguments with spaces and append a CRLF line ending
        return this.process.write([command, ...args].join(' ') + '\r\n')
    }

    /**
     * Run the next matcher on a single line of text
     * @param input Line of text to parse
     * @returns true if the matcher was consumed
     */
    private runNextMatcher(input: string) {
        const matcher = this.matchers[0]
        if (matcher.untilInteractive === true) {
            // Skip the line containing the command
            if (matcher.matches.length === 0) {
                const cr = input.match(Runtime.carriageReturn)
                if (cr !== null) {
                    matcher.matches.push(cr)
                    return false
                }
            }
            // Consume the multi matcher when the debugger is interactive
            const interactive = input.match(Runtime.interactive)
            if (interactive !== null) {
                // Discard the first line
                matcher.matches.shift()
                matcher.resolve(matcher.matches)
                this.matchers.shift()
                return true
            }
        }
        const match = input.match(matcher.pattern)
        if (match !== null) {
            if (matcher.untilInteractive === true) {
                matcher.matches.push(match)
            } else {
                // Consume single matchers on their first match
                matcher.resolve(match)
                this.matchers.shift()
                return true
            }
        }
        return false
    }

    /**
     * Queue up a list of patterns to match on the output
     * 
     * Ensures responses are processed in the order they were requested
     * 
     * @param patterns Patterns (one per line) to match program output
     * @returns A promise that resolves to the match result after all matches
     */
    private async matchResponse(...patterns: RegExp[]) {
        return Promise.all(patterns.map((pattern) => new Promise<RegExpMatchArray>((resolve) => {
            // Queue the matcher
            this.matchers.push({
                pattern,
                resolve
            })

            // Drain the buffer immediately if possible
            while (this.outputBuffer.length > 0) {
                if (this.runNextMatcher(this.outputBuffer.shift())) {
                    return
                }
            }
        })))
    }

    /**
     * Queue up a list of patterns to match on the output
     * 
     * Ensures responses are processed in the order they were requested
     * 
     * @param patterns Patterns (one per line) to match program output
     * @returns A promise that resolves to the match result after all matches
     */
    private async matchUntilInteractive(pattern: RegExp) {
        return new Promise<RegExpMatchArray[]>((resolve) => {
            // Queue the matcher
            this.matchers.push({
                pattern,
                resolve,
                matches: [],
                untilInteractive: true
            })

            // Drain the buffer immediately if possible
            while (this.outputBuffer.length > 0) {
                if (this.runNextMatcher(this.outputBuffer.shift())) {
                    return
                }
            }
        })
    }

    /**
     * Parses the status response with registers and the next instruction
     * 
     * Note: setBreakpoints must be called at least once before this function
     * 
     * @returns An object containing register values and the next line to be evaluated
     */
    private async parseRegisters() {
        const [line1, line2] = await this.matchResponse(
            /A =(?<a>[0-9A-F]*)  B =(?<b>[0-9A-F]*)  SP=(?<sp>[0-9A-F]*)  IE=(?<ie>[0-9A-F]*)  DPH=(?<dph>[0-9A-F]*) DPL=(?<dpl>[0-9A-F]*) PSW=(?<psw>[0-9A-F]*) PC=(?<pc>[0-9A-F]*)/,
            /R0=(?<r0>[0-9A-F]*)  R1=(?<r1>[0-9A-F]*)  R2=(?<r2>[0-9A-F]*)  R3=(?<r3>[0-9A-F]*)  R4=(?<r4>[0-9A-F]*)  R5=(?<r5>[0-9A-F]*)  R6=(?<r6>[0-9A-F]*)  R7=(?<r7>[0-9A-F]*)  BANK=(?<bank>[0-9A-F]*)/,
            Runtime.interactive)
        const line = this.lineMap.lastIndexOf(line1.groups.pc)

        return {
            ...line1.groups,
            ...line2.groups,
            line
        } as unknown as Registers
    }
}