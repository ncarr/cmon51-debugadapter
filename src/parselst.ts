import { readFile } from 'fs'

/**
 * Map ASM line numbers to program memory locations using LST files
 * 
 * Used to correctly place breakpoints from ASM code
 * 
 * @returns An array of memory addresses indexed by line number. Note that
 *          anything after the END instruction will not be in the array
 */
export async function parseLst(asmPath: string) {
    // This program assumes that the last set of consecutive line numbers
    // corresponds to the actual source file and that memory locations are
    // monotonically increasing with line numbers
    return new Promise<string[]>((resolve, reject) => {
        readFile(asmPath.substring(0, asmPath.length - 3) + 'lst', 'utf8', (err, data) => {
            if (err) {
                return reject(err)
            }
            // Regex to match the first part of each line with the address, hex, and line number
            const pattern = /(?<address>[0-9A-F]{4}) (?:[0-9A-F]*)? *(?<line>\d*)/
            const lines = data.split('\r\n')
            
            const lineMap: string[] = []
            let lastLine = -1
            // We assume the last set of consecutive line numbers is from the original file
            for (let i = lines.length - 1; i >= 0; i--) {
                const match = lines[i].match(pattern)
                if (match !== null) {
                    const line = parseInt(match.groups.line)
                    const address = match.groups.address
                    if (lastLine !== -1 && line !== lastLine - 1) {
                        break
                    }
                    lineMap.unshift(address)
                    lastLine = line
                }
            }
            // Pad beginning of array with address 0 so the index corresponds to a line number
            for (; lastLine > 1; lastLine--) {
                lineMap.unshift('0000')
            }

            resolve(lineMap)
        })
    })
}