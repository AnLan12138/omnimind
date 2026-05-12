/// <reference types="vite/client" />

interface Window {
  go: {
    main: {
      App: {
        Connect: (connId: string, session: any) => Promise<void>
        Disconnect: (connId: string) => Promise<void>
        Send: (connId: string, data: string) => Promise<void>
        Resize: (connId: string, rows: number, cols: number) => Promise<void>
        GetConnectionState: (connId: string) => Promise<string>
        ListSessions: () => Promise<any[]>
        SaveSession: (session: any) => Promise<void>
        DeleteSession: (id: string) => Promise<void>
        ListFolders: () => Promise<any[]>
        SaveFolder: (folder: any) => Promise<void>
        DeleteFolder: (id: string) => Promise<void>
        ExportSessions: (filePath: string) => Promise<void>
        ImportSessions: (filePath: string) => Promise<number>
        ListSerialPorts: () => Promise<string[]>
        Greet: (name: string) => Promise<string>
      }
    }
  }
}
