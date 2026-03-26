/*
 Copyright (C) 2022 - 2023 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under
 the terms of the GNU General Public License as published by the Free Software
 Foundation, either version 3 of the License, or (at your option) any later
 version.

 This program is distributed in the hope that it will be useful, but
 WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with
 this program. If not, see <http://www.gnu.org/licenses/>.
*/

declare namespace web3n.rpc {

	interface RPC {
		thisApp?: client.AppRPC;
		otherAppsRPC?: client.OtherAppsRPC;
		exposeService?: service.ExposeService;
	}

	interface ObjProxyMember {
		isObj: boolean;
		name: string;
		members?: ObjProxyMember[];
	}

	interface PassedDatum {
		bytes?: Uint8Array;
		passedByReference?: any[];
	}

	type ExposedObjType = 'FileByteSink' | 'FileByteSource' |
		'FileImpl' | 'FSImpl' | 'SymLinkImpl' | 'FSCollection' | 'FSItemsIter' |
		'IncomingConnection' | 'RPCConnection';

	interface RPCException extends RuntimeException {
		type: 'rpc',
		appDomain: string;
		service: string;
		callerApp?: string;
		callerComponent?: string;
		callerNotAllowed?: true;
		connectionNotAccepted?: true;
		serviceAlreadyExposed?: true;
		serviceNotFound?: true;
		connectionAlreadyWatched?: true;
		connectionClosed?: true;
	}

}

declare namespace web3n.rpc.client {

	type AppRPC = (service: string) => Promise<RPCConnection>;

	type OtherAppsRPC = (
		appDomain: string, service: string
	) => Promise<RPCConnection>;

	interface RPCConnection {
		close(): Promise<void>;
		makeRequestReplyCall(
			method: string, req: PassedDatum|undefined
		): Promise<PassedDatum|undefined>;
		startObservableCall(
			method: string, req: PassedDatum|undefined,
			obs: Observer<PassedDatum|undefined>
		): () => void;
	}

}

declare namespace web3n.rpc.service {

	type ExposeService = (
		service: string, obs: Observer<IncomingConnection>
	) => (() => void);

	interface IncomingConnection {
		close(): Promise<void>;
		watch(obs: Observer<IncomingMsg>): (() => void);
		send(msg: OutgoingMsg): Promise<void>;
	}

	interface CallStart {
		msgType: 'start';
		callNum: number;
		method: string;
		data?: PassedDatum;
	}

	interface CallCancel {
		msgType: 'cancel';
		callNum: number;
	}

	type IncomingMsg = CallStart | CallCancel;

	interface OutgoingMsg {
		callNum: number;
		callStatus: 'end' | 'interim' | 'error';
		data?: PassedDatum;
		err?: any;
	}

}
