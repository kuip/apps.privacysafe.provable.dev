/*
 Copyright (C) 2025 3NSoft Inc.

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


declare namespace web3n.shell.mounts {

	interface VolumeMounts {
		listMounted(): Promise<MountedVolumeInfo[]>;
		mountFS(fs: web3n.files.FS, volumeName: string): Promise<void>;
		unmount(volumeName: string): Promise<void>;
	}

	interface MountedVolumeInfo {
		volumeName: string;
		type: web3n.files.FSType;
		writable: boolean;
		mountPathInDevice: string;
	}

}
