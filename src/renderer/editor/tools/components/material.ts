import { join } from "path";
import filenamify from "filenamify";
import { writeFile } from "fs-extra";

import { Texture, NodeMaterial, TextureBlock } from "babylonjs";

import { Tools } from "../tools";
import { TextureTools } from "./texture";

import { Editor } from "../../editor";

export class MaterialTools {
    /**
     * Exports the given serialized node materials textures to real files.
     * @param editor defines the reference to the editor.
     * @param materials defines the array containing the serialized materials.
     * @param path defines the path where the scene has been saved.
     */
    public static async ExportSerializedNodeMaterialsTextures(editor: Editor, materials: any[], path: string): Promise<string[]> {
        const files: string[] = [];
        const promises: Promise<void>[] = [];

        let textureIndex = 0;

        for (const m of materials ?? []) {
            if (m?.customType !== "BABYLON.NodeMaterial") { continue; }

            const material = editor.scene!.getMaterialByID(m.id) as NodeMaterial;
            if (!material || !(material instanceof NodeMaterial)) { continue; }

            for (const b of m.blocks ?? []) {
                if ((b?.customType !== "BABYLON.TextureBlock" && b?.customType !== "BABYLON.ReflectionBlock" && b?.customType !== "BABYLON.ReflectionTextureBlock") || !b.texture?.name) { continue; }
                if (b.texture.name.indexOf("data:") !== 0) { continue; }

                if (b.customType === "BABYLON.TextureBlock") {
                    const block = material.getTextureBlocks().find((tb) => tb.uniqueId === b.id);
                    if (!block || !(block instanceof TextureBlock) || !block.texture) { continue; }

                    b.texture.url = b.texture.name;
                    b.texture.name = b.texture.metadata?.editorName ?? Tools.RandomId();

                    promises.push(this._ExportSerializedTexture(editor, m, b, block.texture, textureIndex++, path, files));
                    continue;
                }
                
                if (!b.texture.forcedExtension) {
                    b.texture.url = `data:${Tools.RandomId()}`;
                    continue;
                }

                promises.push(this._ExportSerializedCubeTexture(editor, m, b, textureIndex++, path, files));
            }
        }

        await Promise.all(promises);

        return files;
    }

    /**
     * Exports the given serialized texture.
     */
    private static async _ExportSerializedTexture(editor: Editor, material: any, block: any, texture: Texture, index: number, path: string, files: string[]): Promise<void> {
        const buffer = await TextureTools.ConvertTextureToBuffer(texture);
        if (!buffer) { return; }

        const extractedTextureName = filenamify(`${material.name}-${material.id}-${index++}.png`);
        await writeFile(join(path, "files", extractedTextureName), new Buffer(buffer));
        files.push(extractedTextureName);

        block.texture.url = block.texture.name = join("files", extractedTextureName);

        editor.console.logInfo(`Generated NodeMaterial texture for "${material.name}" at ${extractedTextureName}`);
    }

    /**
     * Exports the given serialized cube texture.
     */
    private static async _ExportSerializedCubeTexture(editor: Editor, material: any, block: any, index: number, path: string, files: string[]): Promise<void> {
        const buffer = TextureTools.ConvertOctetStreamToBuffer(block.texture.name);
        const extractedTextureName = filenamify(`${material.name}-${material.id}-${index++}${block.texture.forcedExtension}`);

        await writeFile(join(path, "files", extractedTextureName), buffer);
        files.push(extractedTextureName);

        block.texture.url = block.texture.name = join("files", extractedTextureName);
        editor.console.logInfo(`Generated NodeMaterial texture for "${material.name}" at ${extractedTextureName}`);
    }
}