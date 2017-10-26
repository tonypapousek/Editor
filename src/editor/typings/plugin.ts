import Editor from '../editor';

/**
 * Interface representing an editor plugin
 */
export interface IEditorPlugin {
    divElement: HTMLDivElement;
    name: string;

    create (): Promise<void>;
    close (): Promise<void>;
}

/**
 * Represents an exported editor plugin
 */
export type EditorPluginConstructor = {
    default: new (editor: Editor) => IEditorPlugin;
};

/**
 * Abstract class representing an editor plugin
 */
export abstract class EditorPlugin implements IEditorPlugin {
    // Public members
    public divElement: HTMLDivElement;
    public name: string;

    /**
     * Constructor
     * @param name: the plugin's name
     */
    constructor (name: string) {
        this.name = name;
    }

    /**
     * Creates the plugin
     */
    public abstract async create (): Promise<void>;

    /**
     * Closes the plugin
     */
    public async close (): Promise<void> {
        this.divElement.remove();
    }
}