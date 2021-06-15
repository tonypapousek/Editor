import { move, pathExists, stat } from "fs-extra";
import { basename, dirname, extname, join } from "path";

import { Nullable } from "../../../shared/types";

import * as React from "react";
import SplitPane from "react-split-pane";

import { Editor } from "../editor";

import { FSTools } from "../tools/fs";

import { WorkSpace } from "../project/workspace";

import { AssetsBrowserTree } from "./assets-browser/tree";
import { AssetsBrowserFiles } from "./assets-browser/files";
import { AssetsBrowserItem } from "./assets-browser/files/item";

export interface IAssetsBrowserProps {
	/**
	 * Defines the reference to the editor.
	 */
	editor: Editor;
}

export interface IAssetsBrowserState {
	/**
	 * Defines the current absolute path being browsed.
	 */
	browsedPath: string;
}

export class AssetsBrowser extends React.Component<IAssetsBrowserProps, IAssetsBrowserState> {
	private static _SplitMinSize: number = 200;

	/**
	 * Initializes the assets browser. Will typically create the "assets" folder
	 * located in the root directory of the loaded workspace.
	 */
	public static async Init(): Promise<void> {
		if (!WorkSpace.DirPath) {
			return;
		}

		await FSTools.CreateDirectory(join(WorkSpace.DirPath, "assets"));
	}

	/**
	 * Defines the absolute path to the assets directory.
	 */
	public assetsDirectory: string = "";

	private _editor: Editor;

	private _tree: Nullable<AssetsBrowserTree> = null;
	private _files: Nullable<AssetsBrowserFiles> = null;

	/**
	 * Constructor.
	 * @param props defines the component's props.
	 */
	public constructor(props: IAssetsBrowserProps) {
		super(props);

		this._editor = props.editor;
		this._editor.assetsBrowser = this;

		this.state = {
			browsedPath: "",
		};
	}

	/**
	 * Renders the component.
	 */
	public render(): React.ReactNode {
		if (!this.state.browsedPath) {
			return (<></>);
		}

		return (
			<SplitPane
				split="vertical"
				// size={this.state.paneWidth}
				minSize={AssetsBrowser._SplitMinSize}
				// onChange={(r) => this.setState({ paneWidth: r })}
				// pane2Style={{ width: `${layoutSize.width - this.state.paneWidth}px` }}
			>
				<AssetsBrowserTree
					editor={this._editor}
					ref={(r) => this._tree = r}
					onDirectorySelected={(p) => this._files?.setDirectory(p)}
				/>
				<AssetsBrowserFiles
					editor={this._editor}
					ref={(r) => this._files = r}
					onDirectorySelected={(p) => this._tree?.setDirectory(p)}
				/>
			</SplitPane>
		);
	}

	/**
	 * Sets the workspace directory absolute path and refreshes the component.
	 * @param workspacePath defines the absolute path to the workspace directory.
	 */
	public setWorkspaceDirectoryPath(workspacePath: string): void {
		const browsedPath = join(workspacePath, "assets");

		if (!this.assetsDirectory) {
			this.assetsDirectory = browsedPath;
		}

		this.setState({ browsedPath });

		this._tree?.setDirectory(browsedPath);
		this._files?.setDirectory(browsedPath);
	}

	/**
	 * Refreshes the current directory.
	 */
	public async refresh(): Promise<void> {
		this._tree?.refresh();
		await this._files?.refresh();
	}

	/**
	 * Renames the given file by updating all known references.
	 * @param absolutePath defines the absolute path to the file to rename.
	 * @param newName defines the new name of the file to apply.
	 */
	public async renameFile(absolutePath: string, newName: string): Promise<void> {
		const destination = join(dirname(absolutePath), newName);

		if ((await pathExists(destination))) {
			return;
		}

		const extension = extname(absolutePath).toLowerCase();
		const handler = AssetsBrowserItem._ItemMoveHandlers.find((h) => h.extensions.indexOf(extension) !== -1);
		if (handler) {
			await handler.moveFile(absolutePath, destination);
		}

		await move(absolutePath, destination);

		this.refresh();
	}

	/**
	 * Moves the currently selected items to the given destination folder (to)
	 * @param to defines the absolute path to the folder where to move the asset.
	 * @param items defines the optional list of items to move.
	 */
	public async moveSelectedItems(to: string, items?: string[], renamedFolder?: string): Promise<void> {
		const selectedItems = items ?? this._files?.selectedItems;
		if (!selectedItems?.length) {
			return;
		}

		const promises: Promise<void>[] = [];

		for (const item of selectedItems) {
			const iStats = await stat(item);
			
			if (iStats.isDirectory()) {
				const directoryPromises: Promise<void>[] = [];
				const filesToMove = await FSTools.GetGlobFiles(join(item, "**", "*.*"));

				for (const f of filesToMove) {
					const destination = renamedFolder ?
							dirname(f.replace(item, join(to, renamedFolder))) :
							dirname(f.replace(dirname(item), to));

					directoryPromises.push(this._moveFile(f, destination, false));
				}

				promises.push(new Promise<void>(async (resolve) => {
					await Promise.all(directoryPromises);
					await move(item, join(to, renamedFolder ?? basename(item)));

					resolve();
				}));
			} else {
				promises.push(this._moveFile(item, to, true));
			}
		}

		await Promise.all(promises);
		this.refresh();
	}

	/**
	 * Moves the given file to the given destination. When moving a folder (specific case) the given file
	 * will not be moved as "physicallyMove" will be set to false.
	 */
	private async _moveFile(absolutePath: string, to: string, physicallyMove: boolean): Promise<void> {
		const extension = extname(absolutePath).toLowerCase();
		const destination = join(to, basename(absolutePath));

		const handler = AssetsBrowserItem._ItemMoveHandlers.find((h) => h.extensions.indexOf(extension) !== -1);
		if (handler) {
			await handler.moveFile(absolutePath, destination);
		}

		if (physicallyMove && !(await pathExists(destination))) {
			await move(absolutePath, destination);
		}
	}
}