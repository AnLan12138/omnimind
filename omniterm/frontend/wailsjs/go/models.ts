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

