# cmon51-debugadapter
 Debug Adapter Protocol implementation for CMON51

## Installing
Make sure Quartus Prime, CrossIDE, and CMON51 are already installed. cmon51.tcl must be saved to C:\CrossIDE

Go to the Releases page on GitHub and download the VSIX file for the latest version, then run the 'Extensions: Install from VSIX' command in VS Code

Also see the sampleWorkspace folder for an example VS Code workspace setup

## Limitations
- This extension currently requires at least one breakpoint to be set in the assembly file you are debugging
- Breakpoints can only be set in one file at a time in a workspace
- The program under test must be compiled first and have a matching (non-empty) .lst file
- Since CMON51 does not allow you to reset the debug session, you will need to restart CMON51 before each debug session by holding down KEY3 and FPGA_RESET before you start debugging
- Since CMON51 does not allow you to flash the microprocessor, you will need to manually flash the program under test after every code change

## Contributing

Make sure you have the node-gyp build dependencies for Windows set up, then run the following commands in PowerShell

```powershell
$env:HOME="~/.electron-gyp"
$env:npm_config_target="13.5.2"
$env:npm_config_arch="x64"
$env:npm_config_disturl="https://atom.io/download/electron"
$env:npm_config_runtime="electron"
$env:npm_config_build_from_source="true"
npm install
```

Then open this repository in VS Code and press 'Start Debugging'