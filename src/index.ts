// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

/**
 * TODO:
 *
 * - Hook up as an abstract editor? Or at least as another default editor
 * - `monaco.languages.getLanguages()` contains all of the highlighting modes -
 *
 */

import {
  JupyterLab, JupyterLabPlugin,
} from '@jupyterlab/application';

import {
  ICommandPalette,
} from '@jupyterlab/apputils';

import {
  uuid, PathExt,
} from '@jupyterlab/coreutils';

import {
  IEditorTracker,
} from '@jupyterlab/fileeditor';

import {
  Toolbar,
  ToolbarButton,
} from '@jupyterlab/apputils';
//
// import {
//   IMainMenu,
// } from '@jupyterlab/mainmenu';

// import {
//   CodeConsole,
// } from '@jupyterlab/console';

import {
  PromiseDelegate,
} from '@phosphor/coreutils';

import {
  PanelLayout,
  Widget,
} from '@phosphor/widgets';

import {
  Message,
} from '@phosphor/messaging';

// import {
//   IDisposable, DisposableDelegate,
// } from '@phosphor/disposable';

import * as monaco from 'monaco-editor';

import '../style/index.css';

import * as monacoCSS
// @ts-ignore: error TS2307: Cannot find module
  from 'file-loader?name=[path][name].[ext]!../lib/JUPYTERLAB_FILE_LOADER_jupyterlab-monaco-css.worker.bundle.js';
import * as monacoEditor
// @ts-ignore: error TS2307: Cannot find module
  from 'file-loader?name=[path][name].[ext]!../lib/JUPYTERLAB_FILE_LOADER_jupyterlab-monaco-editor.worker.bundle.js';
import * as monacoHTML
// @ts-ignore: error TS2307: Cannot find module
  from 'file-loader?name=[path][name].[ext]!../lib/JUPYTERLAB_FILE_LOADER_jupyterlab-monaco-html.worker.bundle.js';
import * as monacoJSON
// @ts-ignore: error TS2307: Cannot find module
  from 'file-loader?name=[path][name].[ext]!../lib/JUPYTERLAB_FILE_LOADER_jupyterlab-monaco-json.worker.bundle.js';
import * as monacoTS
// @ts-ignore: error TS2307: Cannot find module
  from 'file-loader?name=[path][name].[ext]!../lib/JUPYTERLAB_FILE_LOADER_jupyterlab-monaco-ts.worker.bundle.js';

/**
 * The class name added to toolbar run button.
 */
const TOOLBAR_RUN_CLASS = 'jp-RunIcon';

let URLS: { [key: string]: string } = {
  css: monacoCSS,
  html: monacoHTML,
  javascript: monacoTS,
  json: monacoJSON,
  typescript: monacoTS,
};

(self as any).MonacoEnvironment = {
  getWorkerUrl: function (moduleId: string, label: string): string {
    let url = URLS[label] || monacoEditor;
    return url;
  },
};

/**
 * Create a toExecutable toolbar item.
 */
export function createRunButton(app: JupyterLab, context: DocumentRegistry.CodeContext): ToolbarButton {

  return new ToolbarButton({
    className: TOOLBAR_RUN_CLASS,
    onClick: () => {
      const { commands } = app;
      const options = {
        path: context.path,
        preferredLanguage: context.model.defaultKernelLanguage,
        kernelPreference: { name: 'python3' },
      };
      commands.execute('console:create', options)
        .then((consolePanel) => {
          const {console: currentConsole} = consolePanel;
          let promptCell = currentConsole.promptCell;
          if (!promptCell) {
            return;
          }
          let model = promptCell.model;
          model.value.text = `!python ${context.contentsModel.name}`;
          currentConsole.execute(true);
        });
    },
    tooltip: 'Run Script',
  });
}

/**
 * A document widget for editors.
 */
export class MonacoFileEditor extends Widget implements DocumentRegistry.IReadyWidget {
  /**
   * Construct a new editor widget.
   */
  constructor(app: JupyterLab, context: DocumentRegistry.CodeContext) {
    super();
    this.addClass('jp-MonacoFileEditor');
    this.id = uuid();
    this.title.label = PathExt.basename(context.localPath);
    this.title.closable = true;
    // this._mimeTypeService = options.mimeTypeService;

    let editorWidget = this.editorWidget = new MonacoWidget(context);
    this.editor = editorWidget.editor;
    this.model = editorWidget.model;
    editorWidget.addClass('jp-Monaco');

    // context.pathChanged.connect(this._onPathChanged, this);
    // this._onPathChanged();

    let layout = this.layout = new PanelLayout();
    let toolbar = new Toolbar();
    toolbar.addClass('jp-MonacoPanel-toolbar');
    toolbar.addItem('run', createRunButton(app, context));
    layout.addWidget(toolbar);
    layout.addWidget(editorWidget);
  }

  /**
   * Get the context for the editor widget.
   */
  get context(): DocumentRegistry.Context {
    return this.editorWidget.context;
  }

  /**
   * A promise that resolves when the file editor is ready.
   */
  get ready(): Promise<void> {
    return this.editorWidget.ready;
  }

  /**
   * Handle `'activate-request'` messages.
   */
  protected onActivateRequest(msg: Message): void {
    this.editor.focus();
  }

  onResize() {
    this.editor.layout();
  }

  onAfterShow() {
    this.editor.layout();
  }

  private editorWidget: MonacoWidget;
  public model: monaco.editor.IModel;
  public editor: monaco.editor.IStandaloneCodeEditor;
  protected _context: DocumentRegistry.Context;
  // private _mimeTypeService: IEditorMimeTypeService;
}

/**
 * An monaco widget.
 */
export class MonacoWidget extends Widget {
  /**
   * Construct a new Monaco widget.
   */
  constructor(context: DocumentRegistry.CodeContext) {
    super();
    this.id = uuid();
    this.title.label = PathExt.basename(context.localPath);
    this.title.closable = true;
    this.context = context;

    // context.ready.then(() => { this._onContextReady(); });
    let content = context.model.toString();
    let uri = monaco.Uri.parse(context.path);
    let monacoModel;
    if (monaco.editor.getModel(uri)) {
      monacoModel = monaco.editor.getModel(uri);
    } else {
      monacoModel = monaco.editor.createModel(content, undefined, uri);
    }
    this.editor = monaco.editor.create(this.node, {
      // model: monaco.editor.createModel(content, undefined, uri),
      model: monacoModel,
    });
    this.model = monacoModel;

    monacoModel.onDidChangeContent((event) => {
      this.context.model.value.text = this.editor.getValue();
    });
    context.ready.then(() => { this._onContextReady(); });
  }

  /**
   * Handle actions that should be taken when the context is ready.
   */
  private _onContextReady(): void {
    if (this.isDisposed) {
      return;
    }
    const contextModel = this.context.model;

    // Set the editor model value.
    this.editor.setValue(contextModel.toString());

    // Wire signal connections.
    contextModel.contentChanged.connect(this._onContentChanged, this);

    // Resolve the ready promise.
    this._ready.resolve(undefined);
  }

  /**
   * Handle a change in context model content.
   */
  private _onContentChanged(): void {
    const oldValue = this.editor.getValue();
    const newValue = this.context.model.toString();

    if (oldValue !== newValue) {
      this.editor.setValue(newValue);
    }
  }

  /**
   * A promise that resolves when the file editor is ready.
   */
  get ready(): Promise<void> {
    return this._ready.promise;
  }

  onResize() {
    this.editor.layout();
  }

  onAfterShow() {
    this.editor.layout();
  }

  context: DocumentRegistry.CodeContext;
  model: monaco.editor.IModel;
  private _ready = new PromiseDelegate<void>();
  editor: monaco.editor.IStandaloneCodeEditor;
}

import {
  ABCWidgetFactory, DocumentRegistry,
} from '@jupyterlab/docregistry';

/**
 * A widget factory for editors.
 */
export class MonacoEditorFactory extends ABCWidgetFactory<MonacoFileEditor, DocumentRegistry.ICodeModel> {
  /**
   * Construct a new editor widget factory.
   */
  constructor(options: MonacoEditorFactory.IOptions) {
    super(options.factoryOptions);
    this._app = options.app;
  }

  /**
   * Create a new widget given a context.
   */
  protected createNewWidget(context: DocumentRegistry.CodeContext): MonacoFileEditor {
    return new MonacoFileEditor(this._app, context);
  }

  _app: JupyterLab;
}

/**
 * The namespace for `MonacoEditorFactory` class statics.
 */
export namespace MonacoEditorFactory {
  /**
   * The options used to create an editor widget factory.
   */
  export interface IOptions {
    /**
     * The editor services used by the factory.
     */
    app: JupyterLab;

    /**
     * The factory options associated with the factory.
     */
    factoryOptions: DocumentRegistry.IWidgetFactoryOptions;
  }
}

/**
 * Initialization data for the jupyterlab-monaco extension.
 *
 * #### Notes
 * The only reason we depend on the IEditorTracker is so that our docregistry
 * 'defaultFor' runs *after* the file editors defaultFor.
 */
const extension: JupyterLabPlugin<void> = {
  id: 'jupyterlab-monaco',
  autoStart: true,
  requires: [ICommandPalette, IEditorTracker],
  activate: (app: JupyterLab, palette: ICommandPalette, editorTracker: IEditorTracker) => {
    // const manager = app.serviceManager;
    // const { commands } = app;
    // const tracker = new InstanceTracker<ConsolePanel>({ namespace: 'console' });

    const factory = new MonacoEditorFactory(
      {
        app,
        factoryOptions: {
          name: 'Monaco Editor',
          fileTypes: ['*'],
          defaultFor: ['*'],
        },
      });
    app.docRegistry.addWidgetFactory(factory);

    // Add an application command
    const command: string = 'monaco:open';
    app.commands.addCommand(command, {
      label: 'Monaco Editor',
      execute: () => {
        let widget = new Widget();
        widget.node.innerHTML = 'Creating new files coming...';
        // let widget = new MonacoWidget();
        app.shell.addToMainArea(widget);

        // Activate the widget
        app.shell.activateById(widget.id);
      },
    });

    // Add the command to the palette.
    palette.addItem({ command, category: 'Monaco' });

  },
};

export default extension;
