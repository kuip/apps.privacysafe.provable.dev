/*
 Copyright (C) 2022, 2024 - 2025 3NSoft Inc.

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


declare namespace web3n.shell {

	interface ShellCAPs {
		fileDialogs?: files.Dialogs;
		deviceFiles?: files.DeviceFiles;
		userNotifications?: notifications.UserNotifications;
		startAppWithParams?: commands.StartAppWithParams;
		getStartedCmd?: commands.GetStartedCmd;
		watchStartCmds?: commands.WatchStartCmds;
		getFSResource?: GetFSResource;

		/**
		 * Opens or focuses opened dashboard app window.
		 */
		openDashboard?: OpenDashboard;

		/**
		 * Opens, or attempts to open given file with apps present in the system.
		 */
		openFile?: OpenFile;

		/**
		 * Opens folder in file explorer.
		 */
		openFolder?: OpenFolder;

		/**
		 * Opens URL, or attempts to open given URL with apps/browsers present in the system.
		 */
		openURL?: OpenURL;

		/**
		 * Clipboard of the device.
		 * Copy/paste works at least on some linuxies on electron-based implementation
		 * without this capability, but mac is stricter. This capability should be
		 * used for predictable results.
		 */
		clipboard?: Partial<shell.clipboard.Clipboard>;
	}

	type GetFSResource = (
		appDomain: string|null|undefined, resourceName: string
	) => Promise<web3n.files.ReadonlyFS|web3n.files.ReadonlyFile>;

	type OpenDashboard = () => Promise<void>;

	type OpenFile = (file: web3n.files.File) => Promise<void>;

	type OpenFolder = (fs: web3n.files.FS) => Promise<void>;

	type OpenURL = (url: string) => Promise<void>;

	interface FSResourceException extends RuntimeException {
		type: 'fs-resource';
		resourceAppDomain: string;
		requestingAppDomain: string;
		requestingComponent: string;
		resourceName: string;
		notAllowed?: true;
		resourceNotFound?: true;
		resourceNotInitialized?: true;
	}

}
