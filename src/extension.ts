import * as vscode from 'vscode'
import { Cmon51DebugSession } from './adapter';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('CMON51', new InlineDebugAdapterFactory()))
}

export function deactivate() {
}

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
	createDebugAdapterDescriptor(_session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
		return new vscode.DebugAdapterInlineImplementation(new Cmon51DebugSession());
	}
}