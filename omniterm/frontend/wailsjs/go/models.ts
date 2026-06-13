export namespace ai {
	
	export class ClientConfig {
	    provider: string;
	    apiKey: string;
	    model: string;
	    baseURL: string;
	
	    static createFrom(source: any = {}) {
	        return new ClientConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.apiKey = source["apiKey"];
	        this.model = source["model"];
	        this.baseURL = source["baseURL"];
	    }
	}
	export class ToolCallFunc {
	    name: string;
	    arguments: string;
	
	    static createFrom(source: any = {}) {
	        return new ToolCallFunc(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.arguments = source["arguments"];
	    }
	}
	export class ToolCall {
	    id: string;
	    type: string;
	    function: ToolCallFunc;
	
	    static createFrom(source: any = {}) {
	        return new ToolCall(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.type = source["type"];
	        this.function = this.convertValues(source["function"], ToolCallFunc);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Message {
	    role: string;
	    content?: string;
	    reasoning_content?: string;
	    tool_calls?: ToolCall[];
	    tool_call_id?: string;
	
	    static createFrom(source: any = {}) {
	        return new Message(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.role = source["role"];
	        this.content = source["content"];
	        this.reasoning_content = source["reasoning_content"];
	        this.tool_calls = this.convertValues(source["tool_calls"], ToolCall);
	        this.tool_call_id = source["tool_call_id"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RAGDocument {
	    id: string;
	    title: string;
	    content: string;
	    tags: string[];
	
	    static createFrom(source: any = {}) {
	        return new RAGDocument(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.content = source["content"];
	        this.tags = source["tags"];
	    }
	}
	

}

export namespace config {
	
	export class ReleaseAsset {
	    name: string;
	    browser_download_url: string;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new ReleaseAsset(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.browser_download_url = source["browser_download_url"];
	        this.size = source["size"];
	    }
	}
	export class ReleaseInfo {
	    tag_name: string;
	    name: string;
	    body: string;
	    assets: ReleaseAsset[];
	
	    static createFrom(source: any = {}) {
	        return new ReleaseInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tag_name = source["tag_name"];
	        this.name = source["name"];
	        this.body = source["body"];
	        this.assets = this.convertValues(source["assets"], ReleaseAsset);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace device {
	
	export class DeviceInfo {
	    vendor: string;
	    category: string;
	    os: string;
	    osVersion: string;
	    model: string;
	    serial: string;
	    hostname: string;
	    arch: string;
	    confidence: number;
	    method: string;
	
	    static createFrom(source: any = {}) {
	        return new DeviceInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.vendor = source["vendor"];
	        this.category = source["category"];
	        this.os = source["os"];
	        this.osVersion = source["osVersion"];
	        this.model = source["model"];
	        this.serial = source["serial"];
	        this.hostname = source["hostname"];
	        this.arch = source["arch"];
	        this.confidence = source["confidence"];
	        this.method = source["method"];
	    }
	}

}

export namespace filetransfer {
	
	export class FileInfo {
	    name: string;
	    path: string;
	    size: number;
	    isDir: boolean;
	    modTime: string;
	    perm: string;
	
	    static createFrom(source: any = {}) {
	        return new FileInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.size = source["size"];
	        this.isDir = source["isDir"];
	        this.modTime = source["modTime"];
	        this.perm = source["perm"];
	    }
	}

}

export namespace ftp {
	
	export class FileInfo {
	    name: string;
	    path: string;
	    size: number;
	    isDir: boolean;
	    modTime: string;
	
	    static createFrom(source: any = {}) {
	        return new FileInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.size = source["size"];
	        this.isDir = source["isDir"];
	        this.modTime = source["modTime"];
	    }
	}

}

export namespace session {
	
	export class Folder {
	    id: string;
	    name: string;
	    parentId?: string;
	    sortOrder: number;
	
	    static createFrom(source: any = {}) {
	        return new Folder(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.parentId = source["parentId"];
	        this.sortOrder = source["sortOrder"];
	    }
	}
	export class Session {
	    id: string;
	    name: string;
	    protocol: string;
	    host: string;
	    port: number;
	    username?: string;
	    password?: string;
	    privateKeyPath?: string;
	    useAgent?: boolean;
	    proxyJump?: string;
	    keepAliveSec?: number;
	    telnetTermType?: string;
	    termType?: string;
	    useTLS?: boolean;
	    tlsSkipVerify?: boolean;
	    useFTPS?: string;
	    baudRate?: number;
	    dataBits?: number;
	    stopBits?: number;
	    parity?: string;
	    flowControl?: string;
	    folderId?: string;
	    sortOrder: number;
	    colorLabel?: string;
	    notes?: string;
	    createdAt: string;
	    updatedAt: string;
	
	    static createFrom(source: any = {}) {
	        return new Session(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.protocol = source["protocol"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.password = source["password"];
	        this.privateKeyPath = source["privateKeyPath"];
	        this.useAgent = source["useAgent"];
	        this.proxyJump = source["proxyJump"];
	        this.keepAliveSec = source["keepAliveSec"];
	        this.telnetTermType = source["telnetTermType"];
	        this.termType = source["termType"];
	        this.useTLS = source["useTLS"];
	        this.tlsSkipVerify = source["tlsSkipVerify"];
	        this.useFTPS = source["useFTPS"];
	        this.baudRate = source["baudRate"];
	        this.dataBits = source["dataBits"];
	        this.stopBits = source["stopBits"];
	        this.parity = source["parity"];
	        this.flowControl = source["flowControl"];
	        this.folderId = source["folderId"];
	        this.sortOrder = source["sortOrder"];
	        this.colorLabel = source["colorLabel"];
	        this.notes = source["notes"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
	    }
	}

}

export namespace skill {
	
	export class ModeRule {
	    Mode: string;
	    Match: string;
	
	    static createFrom(source: any = {}) {
	        return new ModeRule(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Mode = source["Mode"];
	        this.Match = source["Match"];
	    }
	}
	export class PromptRule {
	    Patterns: string[];
	    Exclude: string[];
	
	    static createFrom(source: any = {}) {
	        return new PromptRule(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Patterns = source["Patterns"];
	        this.Exclude = source["Exclude"];
	    }
	}
	export class VendorRule {
	    Vendor: string;
	    Banner: string[];
	    Prompt: PromptRule;
	
	    static createFrom(source: any = {}) {
	        return new VendorRule(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Vendor = source["Vendor"];
	        this.Banner = source["Banner"];
	        this.Prompt = this.convertValues(source["Prompt"], PromptRule);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Skill {
	    ID: string;
	    Name: string;
	    Version: string;
	    Author: string;
	    Description: string;
	    Requires: string;
	    Commands: Record<string, string>;
	    Enabled: boolean;
	    Builtin: boolean;
	    VendorRules: VendorRule[];
	    ModeRules: Record<string, Array<ModeRule>>;
	
	    static createFrom(source: any = {}) {
	        return new Skill(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ID = source["ID"];
	        this.Name = source["Name"];
	        this.Version = source["Version"];
	        this.Author = source["Author"];
	        this.Description = source["Description"];
	        this.Requires = source["Requires"];
	        this.Commands = source["Commands"];
	        this.Enabled = source["Enabled"];
	        this.Builtin = source["Builtin"];
	        this.VendorRules = this.convertValues(source["VendorRules"], VendorRule);
	        this.ModeRules = this.convertValues(source["ModeRules"], Array<ModeRule>, true);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

