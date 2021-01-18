import { Nullable } from "../../../shared/types";

import { Scene } from "babylonjs";
import { LGraphNode, LiteGraph, LLink, SerializedLGraphNode, Vector2, LGraphCanvas, WidgetCallback, IWidget } from "litegraph.js";

import { Tools } from "../tools/tools";
import { undoRedo } from "../tools/undo-redo";

import { NodeUtils } from "./utils";

declare module "litegraph.js" {
    export interface LGraphNode {
        widgets?: IWidget[];
    }
}

export enum CodeGenerationOutputType {
    Constant = 0,
    Variable,
    Function,
    CallbackFunction,
    Condition,
    FunctionWithCallback,
}

export enum CodeGenerationExecutionType {
    Start = 0,
    Update,
    Properties,
}

export enum ELinkErrorType {
    /**
     * Defines a link error raised when user wants to connect multiple nodes for an "EVENT".
     */
    MultipleEvent = 0,
}

export interface ICodeGenerationOutput {
    /**
     * Defines the type of the output.
     */
    type: CodeGenerationOutputType;
    /**
     * Defines the generated code as string for the overall node.
     */
    code: string;
    /**
     * Defines the code generated for each output of the node.
     */
    outputsCode?: {
        /**
         * Defines the code generated by the output.
         */
        code?: string;
        /**
         * Defines wether or not the output is the name of the variable in "this".
         */
        thisVariable?: boolean;
    }[];
    /**
     * Defines where the execution should appear (onStart or onUpdate?).
     */
    executionType?: CodeGenerationExecutionType;
    /**
     * In case of a variable, this contains the name of the variable that is being generated an its value.
     */
    variable?: {
        /**
         * Defines the name of the variable.
         */
        name: string;
        /**
         * Defines the type of the variable.
         */
        type: string;
        /**
         * Defines the default value of the variable.
         */
        value: string;
        /**
         * Defines wether or not the variable is visibile in the inspector.
         */
        visibleInInspector?: boolean;
    }
    requires?: {
        /**
         * Defines the name of the module to require.
         */
        module: string;
        /**
         * Defines the classes the require from the module.
         */
        classes: string[];
    }[];
}

export interface INodeContextMenuOption {
    /**
     * Defines the label of the extra option in the context menu.
     */
    label: string;
    /**
     * Defines the callback caleld on the menu has been clicked.
     */
    onClick: () => void;
}

export abstract class GraphNode<TProperties = Record<string, any>> extends LGraphNode {
    /**
     * Defines all the available properties of the node.
     */
    public properties: TProperties;
    /**
     * Defines wether or not a break point is set on the node.
     */
    public hasBeakPoint: boolean = false;
    /**
     * Defines wether or not the node is paused on its breakpoint.
     */
    public pausedOnBreakPoint: boolean = false;

    /**
     * Defines the id of the node to be used internally.
     */
    public readonly internalId: string = Tools.RandomId();

    /**
     * Defines the callback called on a widget changes.
     */
    public onWidgetChange: Nullable<() => void> = null;

    /**
     * @hidden
     */
    public _lastPosition: Vector2 = [0, 0];

    private _resumeFn: Nullable<() => void> = null;
    private _mouseOver: boolean = false;
    private _isExecuting: boolean = false;
    private _callingWidgetCallback: boolean = false;

    /**
     * Constructor.
     * @param title defines the title of the node.
     */
    public constructor(title?: string) {
        super(title);
    }

    /**
     * Returns the current scene where the graph is running.
     */
    public getScene(): Scene {
        return (this.graph as any).scene;
    }

    /**
     * Called on the graph is being started.
     */
    public onStart(): void {
        // Nothing to do by default.
    }

    /**
     * Called on the graph is being stopped.
     */
    public onStop(): void {
        this.pausedOnBreakPoint = false;
        this._isExecuting = false;

        NodeUtils.PausedNode = null;
    }

    /**
     * Configures the node from an object containing the serialized infos.
     * @param infos defines the JSON representation of the node.
     */
    public configure(infos: SerializedLGraphNode): void {
        super.configure(infos);

        this.widgets?.forEach((w) => {
            if (!w.name) { return; }
            if (this.properties[w.name]) {
                w.value = this.properties[w.name];
            }
        });

        this._lastPosition[0] = this.pos[0];
        this._lastPosition[1] = this.pos[1];
    }

    /**
     * Retrieves the input data (data traveling through the connection) from one slot
     * @param slot defines the slot id to get its input data.
     * @param force_update defines wether or not to force the connected node of this slot to output data into this link
     */
    public getInputData<T = any>(slot: number, force_update?: boolean): T {
        let force = force_update ?? false;
        for (const linkId in this.graph?.links ?? { }) {
            const link = this.graph!.links[linkId];
            if (link.target_id === this.id && link.target_slot === slot) {
                const originNode = this.graph!.getNodeById(link.origin_id);
                if (originNode && originNode.mode === LiteGraph.ALWAYS) {
                    force = true;
                    break;
                }
            }
        }

        return super.getInputData(slot, /* slot > 0 ? true : false */ force);
    }

    /**
     * On connections changed for this node, change its mode according to the new connections.
     * @param type input (1) or output (2).
     * @param slot the slot which has been modified.
     * @param added if the connection is newly added.
     * @param link the link object informations.
     * @param input the input object to check its type etc.
     */
    public onConnectionsChange(type: number, _: number, added: boolean, link: LLink, input: any): void {
        if (this.mode === LiteGraph.NEVER) { return; }
        
        // Changed output type?
        if (link?.type && type === LiteGraph.INPUT && input?.linkedOutput) {
            const outputIndex = this.outputs.findIndex((o) => o.name === input.linkedOutput);
            if (outputIndex !== -1) {
                const parentNode = this.graph!.getNodeById(link.origin_id);
                if (parentNode) {
                    this.outputs[outputIndex].type = parentNode.outputs[link.origin_slot].type;
                }

                this.updateConnectedNodesFromOutput(outputIndex);
            }
        }

        // Change mode?
        if (link && type === LiteGraph.INPUT && input.type === LiteGraph.EVENT) {
            if (added && input.type === LiteGraph.EVENT) {
                this.mode = LiteGraph.ON_TRIGGER;
            } else {
                this.mode = LiteGraph.ALWAYS;
            }
        }

        NodeUtils.SetColor(this);
    }

    /**
     * Called on a property changed.
     * @param name defines the name of the property that changed.
     * @param value defines the new value of the property.
     */
    public propertyChanged(name: string, value: any): boolean {
        for (const w of this.widgets ?? []) {
            if (w.name !== name) { continue; }
            w.value = value;

            if (w.callback) {
                this._callingWidgetCallback = true;
                w.callback(value, this.graph?.list_of_graphcanvas[0]!, this, this.pos);
                this._callingWidgetCallback = false;
            }
            break;
        }

        return true;
    }

    /**
     * Adds a new widget to the node.
     * @param type defines the type of widget.
     * @param name defines the name of the widget.
     * @param value defines the default value of the widget.
     * @param callback defines the callback called on the widget changed.
     * @param options defines the widget options.
     */
    public addWidget<T extends IWidget>(type: T["type"], name: string, value: T["value"], callback?: WidgetCallback<T>, options?: T["options"]): T {
        const originalCallback = callback as any;

        let timeout: Nullable<number> = null;
        let initialValue: any;

        setTimeout(() => {
            // Call this after the configure.
            const split = name.split(".");
            if (split.length > 1) {
                const p = Tools.GetEffectiveProperty<any>(this.properties, name);
                initialValue = p[split[split.length - 1]];
            } else {
                initialValue = this.properties[name];
            }
        }, 0);

        callback = (v, g, n, p, e) => {
            if (originalCallback) { originalCallback(v, g, n, p, e); }
            if (this.onWidgetChange) { this.onWidgetChange(); }

            if (this._callingWidgetCallback) { return; }

            if (timeout) {
                clearTimeout(timeout);
                timeout = null;
            }

            timeout = setTimeout(() => {
                const oldValue = initialValue;
                const newValue = v;

                initialValue = v;

                undoRedo.push({
                    common: () => {
                        this.setDirtyCanvas(true, true);
                        if (this.onWidgetChange) { this.onWidgetChange(); }
                    },
                    undo: () => {
                        originalCallback(oldValue, g, n, p, e);
                        this.propertyChanged(name, oldValue);
                    },
                    redo: () => {
                        originalCallback(newValue, g, n, p, e);
                        this.propertyChanged(name, newValue);
                    },
                });
            }, 500) as any;
        };

        return super.addWidget(type, name, value, callback, options);
    }

    /**
     * Triggers an slot event in this node.
     * @param slot the index of the output slot.
     * @param param defines the parameters to send to the target slot.
     * @param link_id in case you want to trigger and specific output link in a slot.
     */
    public async triggerSlot(slot: number, param?: any, link_id?: number): Promise<void> {
        if (this.graph!.hasPaused) {
            await this.waitForBreakPoint();
        }
        
        return super.triggerSlot(slot, param ?? null, link_id);
    }

    /**
     * Called on the node is being executed.
     */
    public async onExecute(): Promise<void> {
        if (this._isExecuting) {
            return;
        }

        this._isExecuting = true;

        while (this.graph!.hasPaused) {
            await this.waitForBreakPoint();
        }

        if (this.hasBeakPoint) {
            this.graph!.hasPaused = true;
            this.pausedOnBreakPoint = true;
            
            this.focusOn();
            this.getScene()?.render();

            NodeUtils.PausedNode = this;
            await this.waitForBreakPoint();
            NodeUtils.PausedNode = null;
        }

        try {
            await this.execute();
        } catch (e) {
            console.error(e);
        }

        while (this.graph!.hasPaused) {
            await this.waitForBreakPoint();
        }

        this._isExecuting = false;
    }

    /**
     * In case of a breakpoint, resumes the graph.
     */
    public resume(): void {
        if (this._resumeFn) {
            this._resumeFn();
        }

        this._resumeFn = null;
    }

    /**
     * Sets the graph canvas to focus on this node.
     */
    public focusOn(): void {
        const graphCanvas = this.graph!.list_of_graphcanvas[0];
        if (!graphCanvas) { return; }

        const start = graphCanvas.ds.offset.slice();
        graphCanvas.centerOnNode(this as any);

        const end = graphCanvas.ds.offset.slice();
        graphCanvas.ds.offset[0] = start[0];
        graphCanvas.ds.offset[1] = start[1];

        const anim = {
            get x() { return graphCanvas.ds.offset[0]; },
            set x(x: number) { graphCanvas.ds.offset[0] = x; graphCanvas.setDirty(true, true); },

            get y() { return graphCanvas.ds.offset[1]; },
            set y(y: number) { graphCanvas.ds.offset[1] = y; graphCanvas.setDirty(true, true); },
        };

        jQuery(anim).animate({ x: end[0], y: end[1] }, 750, "swing");
    }

    /**
     * Called on the node is being executed.
     */
    public abstract execute(): void | Promise<void>;

    /**
     * Generates the code of the node.
     * @param parent defines the parent node that has been generated.
     */
    public abstract generateCode(...inputs: ICodeGenerationOutput[]): ICodeGenerationOutput;

    /**
     * Waits until the graph is resumed.
     */
    public waitForBreakPoint(): Promise<void> {
        if (!this.graph) { return Promise.resolve(); }
        return new Promise<void>((resolve) => this._resumeFn = resolve);
    }

    /**
     * Draws the foreground of the node.
     */
    public onDrawForeground(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
        // Collapsed?
        if (this.flags["collapsed"]) { return; }

        // Mode?
        if (this.mode !== LiteGraph.ON_TRIGGER) { return; }

        ctx = canvas as any as CanvasRenderingContext2D;

        if (this.hasBeakPoint) {
            if (this.pausedOnBreakPoint) {
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(this.size[0] - 20, -25);
                ctx.lineTo(this.size[0] - 20, -5);
                ctx.lineTo(this.size[0] - 5, -15);
                ctx.fillStyle = "#FF0000";
                ctx.fill();
                ctx.closePath();
                ctx.restore();
            } else {
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.arc(this.size[0] - 20, -15, 10, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${this.pausedOnBreakPoint ? 255 : 100}, 0, 0, 255)`;
                ctx.fill();
                ctx.closePath();
                ctx.restore();
            }
        } else if (this._mouseOver) {
            ctx.save();
            ctx.beginPath();
            ctx.strokeStyle = "#ff0000";
            ctx.arc(this.size[0] - 20, -15, 10, 0, Math.PI * 2);
            ctx.stroke();
            ctx.closePath();
            ctx.restore();
        }
    }

    /**
     * Called each time the background is drawn.
     * @param ctx defines the rendering context of the canvas.
     */
    public onDrawBackground(canvas: HTMLCanvasElement, _: CanvasRenderingContext2D): void {
        // Nothing to do now...
        if (this.flags["collapsed"]) { return; }
        
        this.drawBackground(canvas as any);
    }

    /**
     * Called each time the background is drawn.
     * @param ctx defines the rendering context of the canvas.
     */
    public drawBackground(_: CanvasRenderingContext2D): void {
        // Nothin to do now...
    }

    /**
     * Called on the mouse is down on the node.
     * @param event defines the reference to the mouse original event.
     * @param pos defines the position.
     * @param graphCanvas defines the canvas where the node is drawn.
     */
    public onMouseDown(event: MouseEvent, pos: Vector2, graphCanvas: LGraphCanvas): void {
        if (super.onMouseDown) {
            super.onMouseDown(event, pos, graphCanvas);
        }

        // Collapsed?
        if (this.flags["collapsed"]) { return; }

        // Mode?
        if (this.mode !== LiteGraph.ON_TRIGGER) { return; }

        if (pos[0] >= this.size[0] - 30 && pos[1] <= 5) {
            if (this.graph) {
                this.graph.list_of_graphcanvas[0].canvas.style.cursor = "";
            }

            if (this.pausedOnBreakPoint) {
                NodeUtils.ResumeExecution();
            } else {
                this.hasBeakPoint = !this.hasBeakPoint;
            }
        }
    }

    /**
     * Called on the mouse enters the node.
     * @param event defines the reference to the mouse original event.
     * @param pos defines the position.
     * @param graphCanvas defines the canvas where the node is drawn.
     */
    public onMouseMove(_: MouseEvent, pos: Vector2, __: LGraphCanvas): void {
        // Collapsed?
        if (this.flags["collapsed"]) { return; }

        // Mode?
        if (this.mode !== LiteGraph.ON_TRIGGER) { return; }
        
        if (pos[0] >= this.size[0] - 30 && pos[1] <= 5) {
            setTimeout(() => this.graph!.list_of_graphcanvas[0].canvas.style.cursor = "pointer", 0);
        }
    }

    /**
     * Called on the mouse enters the node.
     * @param event defines the reference to the mouse original event.
     * @param pos defines the position.
     * @param graphCanvas defines the canvas where the node is drawn.
     */
    public onMouseEnter(event: MouseEvent, pos: Vector2, graphCanvas: LGraphCanvas): void {
        if (super.onMouseEnter) {
            super.onMouseEnter(event, pos, graphCanvas);
        }

        this._mouseOver = true;
    }

    /**
     * Called on the mouse leaves the node.
     * @param event defines the reference to the mouse original event.
     * @param pos defines the position.
     * @param graphCanvas defines the canvas where the node is drawn.
     */
    public onMouseLeave(event: MouseEvent, pos: Vector2, graphCanvas: LGraphCanvas): void {
        if (super.onMouseLeave) {
            super.onMouseLeave(event, pos, graphCanvas);
        }

        this._mouseOver = false;
    }

    /**
     * Called on the node is right-clicked in the Graph Editor.
     * This is used to show extra options in the context menu.
     */
    public getContextMenuOptions?(): INodeContextMenuOption[];

    /**
     * Returns the list of nodes connected to the given output.
     * @param outputId defines the Id of the output.
     */
    public getConnectedNodesFromOutput(outputId: number): { node: GraphNode; inputId: number; }[] {
        if (!this.graph) { return []; }

        const result: { node: GraphNode; inputId: number; }[] = [];
        for (const linkId in this.graph.links) {
            const link = this.graph.links[linkId];
            if (link.origin_id !== this.id || link.origin_slot !== outputId) {
                continue;
            }

            const node = this.graph.getNodeById(link.target_id) as GraphNode;
            if (node) {
                result.push({ node, inputId: link.target_slot });
            }
        }

        return result;
    }

    /**
     * Updates the given output's children nodes.
     * @param outputId defines the Id of the output that has been updated.
     */
    public updateConnectedNodesFromOutput(outputId: number): void {
        const connected = this.getConnectedNodesFromOutput(outputId);
        connected.forEach((c) => this.connect(outputId, c.node, c.inputId));
    }
}
