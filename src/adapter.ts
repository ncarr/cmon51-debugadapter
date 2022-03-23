import { Breakpoint, DebugSession, ExitedEvent, InitializedEvent, OutputEvent, Scope, Source, StackFrame, StoppedEvent, TerminatedEvent, Thread, Variable } from '@vscode/debugadapter'
import { DebugProtocol } from '@vscode/debugprotocol';
import { basename } from 'path';
import { Registers, Runtime } from './runtime';

/**
 * Main class implementing the Debug Adapter Protocol
 */
export class Cmon51DebugSession extends DebugSession {
    /**
     * The runtime is single-threaded
     */
    private static threadID = 1;
    
    private _runtime: Runtime
    private _registers: Registers

    public constructor() {
        super();
        this.setDebuggerLinesStartAt1(false);

        this._runtime = new Runtime()
        this._runtime.on('output', (output) => this.sendEvent(new OutputEvent(output, 'console')))
    }

    protected async initializeRequest(response: DebugProtocol.InitializeResponse) {
        response.body = response.body || {}
        response.body.supportsSetVariable = true
        response.body.supportsDisassembleRequest = true
        response.body.supportsTerminateRequest = true
        response.body.supportsConfigurationDoneRequest = true

        this.sendResponse(response)

        await this._runtime.initialize()

        this.sendEvent(new InitializedEvent())
    }

    protected async configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse) {
        this.continueRequest(<DebugProtocol.ContinueResponse> response)
    }

    protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments) {
        const breakpoints = await this._runtime.setBreakpoints(args.source.path, args.lines.map(line => this.convertClientLineToDebugger(line)))
        
        response.body = {
            breakpoints: breakpoints.map((line) => new Breakpoint(true, this.convertDebuggerLineToClient(line)))
        }
        this.sendResponse(response)
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse) {
        response.body = {
            threads: [
                new Thread(Cmon51DebugSession.threadID, 'Main thread')
            ]
        }
        this.sendResponse(response)
    }

    protected stackTraceRequest(response: DebugProtocol.StackTraceResponse) {
        const path = this._runtime.getFile()
        const frame = new StackFrame(0, 'Default frame', new Source(basename(path), this.convertDebuggerPathToClient(path)), this.convertDebuggerLineToClient(this._registers.line))
        frame.instructionPointerReference = this._registers.pc

        response.body = {
            stackFrames: [
                frame
            ]
        }
        this.sendResponse(response)
    }

    protected scopesRequest(response: DebugProtocol.ScopesResponse) {
        response.body = {
            scopes: [
                new Scope('Registers', 1000, false)
            ]
        }
        this.sendResponse(response)
    }

    protected async variablesRequest(response: DebugProtocol.VariablesResponse) {
        const registers = this._registers

        response.body = {
            variables: [
                new Variable('A', registers.a),
                new Variable('B', registers.b),
                new Variable('SP', registers.sp),
                new Variable('IE', registers.ie),
                new Variable('DPH', registers.dph),
                new Variable('DPL', registers.dpl),
                new Variable('PSW', registers.psw),
                new Variable('PC', registers.pc),
                new Variable('R0', registers.r0),
                new Variable('R1', registers.r1),
                new Variable('R2', registers.r2),
                new Variable('R3', registers.r3),
                new Variable('R4', registers.r4),
                new Variable('R5', registers.r5),
                new Variable('R6', registers.r6),
                new Variable('R7', registers.r7),
                new Variable('BANK', registers.bank),
            ]
        }
        this.sendResponse(response)
    }

    protected async setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments) {
        await this._runtime.setVariable(args.name, args.value)

        response.body = {
            value: args.value
        }

        this.sendResponse(response)
    }

    protected async continueRequest(response: DebugProtocol.ContinueResponse) {
        this.sendResponse(response)
        this._registers = await this._runtime.continue()
        this.sendEvent(new StoppedEvent('breakpoint', Cmon51DebugSession.threadID))
    }

    protected async nextRequest(response: DebugProtocol.NextResponse) {
        this.sendResponse(response)
        this._registers = await this._runtime.next()
        this.sendEvent(new StoppedEvent('step', Cmon51DebugSession.threadID))
    }

    protected stepInRequest(response: DebugProtocol.StepInResponse) {
        this.nextRequest(<DebugProtocol.NextResponse> response)
    }

    protected stepOutRequest(response: DebugProtocol.StepInResponse) {
        this.nextRequest(<DebugProtocol.NextResponse> response)
    }

    protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) {
        await this._runtime.evaluate(args.expression)

        response.body = {
            result: '',
            variablesReference: 0
        }
        this.sendResponse(response)
    }

    protected async disassembleRequest(response: DebugProtocol.DisassembleResponse, args: DebugProtocol.DisassembleArguments, request?: DebugProtocol.Request): Promise<void> {
        const start = parseInt(args.memoryReference, 16) + args.offset
        const instructions = await this._runtime.disassemble(start, args.instructionCount, args.instructionOffset)

        response.body = {
            instructions
        }

        this.sendResponse(response)
    }

    protected async terminateRequest(response: DebugProtocol.TerminateResponse) {
        this.sendResponse(response)
        let exitCode = 0
        try {
            await this._runtime.terminate()
        } catch(e) {
            exitCode = e
        }
        this.sendEvent(new TerminatedEvent())
        this.sendEvent(new ExitedEvent(exitCode))
    }

    protected disconnectRequest(response: DebugProtocol.DisconnectResponse) {
        this.sendResponse(response)
        this._runtime.disconnect()
    }
}