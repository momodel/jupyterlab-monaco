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
  ILayoutRestorer,
  JupyterLab, JupyterLabPlugin,
} from '@jupyterlab/application';

import {
  ICommandPalette, showDialog, Dialog,
} from '@jupyterlab/apputils';

import {
  uuid, PathExt,
} from '@jupyterlab/coreutils';

import {
  Toolbar,
  ToolbarButton,
  InstanceTracker,
} from '@jupyterlab/apputils';
//
// import {
//   IMainMenu,
// } from '@jupyterlab/mainmenu';

import {
  IConsoleTracker,
} from '@jupyterlab/console';

import {
  PromiseDelegate,
} from '@phosphor/coreutils';

import {
  DockLayout,
  PanelLayout,
  Widget,
} from '@phosphor/widgets';

import {
  Message,
} from '@phosphor/messaging';
import { message, Modal } from 'antd';

// import * as _ from 'lodash';
// var algorithm_1 = require("@phosphor/algorithm");
// import {
//   IDisposable, DisposableDelegate,
// } from '@phosphor/disposable';

import * as monaco from 'monaco-editor';

import { listen, MessageConnection } from 'vscode-ws-jsonrpc';
import {
  BaseLanguageClient, CloseAction, ErrorAction,
  createMonacoServices, createConnection,
} from 'monaco-languageclient';
import normalizeUrl = require('normalize-url');
import ReconnectingWebSocket = require('reconnecting-websocket');
import { webServer } from '../../../../../../config';
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

import { createJob, getUserInfo, getUserJobs } from './services';

/**
 * The class name added to toolbar run button.
 */
const TOOLBAR_RUN_CLASS = 'jp-RunIcon';
// const TOOLBAR_GPU_RUN_CLASS = 'jp-GPURunIcon';

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

// register Monaco languages
monaco.languages.register({
  id: 'python',
  extensions: ['.py'],
  aliases: ['python', 'Python', 'py'],
  mimetypes: ['text/plain'],
});

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

//     // create Monaco editor
//     const value = `{
//     "$schema": "http://json.schemastore.org/coffeelint",
//     "line_endings": "unix"
// }`;
//     const editor = monaco.editor.create(document.getElementById('container')!, {
//       model: monaco.editor.createModel(value, 'json', monaco.Uri.parse('inmemory://model.json')),
//       glyphMargin: true,
//       lightbulb: {
//         enabled: true
//       }
//     });

    // install Monaco language client services
    const services = createMonacoServices(this.editor as any);

    const hash = window.location.hash;
    const match = pathToRegexp('#/workspace/:appId/:type/:classroom').exec(hash);
    request(`pyapi/project/hub_name/${match[1]}`,
      undefined,
      {
        onJson: (res: any) => {
          // create the web socket
          const url = createUrl('/sampleServer', res.hub_name);
          const webSocket = createWebSocket(url);
          // listen when the web socket is opened
          listen({
            webSocket,
            onConnection: connection => {
              // create and start the language client
              const languageClient = createLanguageClient(connection);
              const disposable = languageClient.start();
              connection.onClose(() => disposable.dispose());
            },
          });
        },
      });

    function createLanguageClient(connection: MessageConnection): BaseLanguageClient {
      return new BaseLanguageClient({
        name: 'Sample Language Client',
        clientOptions: {
          // use a language id as a document selector
          documentSelector: ['python'],
          // disable the default error handler
          errorHandler: {
            error: () => ErrorAction.Continue,
            closed: () => CloseAction.DoNotRestart,
          },
        },
        services,
        // create a language client connection from the JSON RPC connection on demand
        connectionProvider: {
          get: (errorHandler, closeHandler) => {
            return Promise.resolve(createConnection(connection, errorHandler, closeHandler));
          },
        },
      });
    }

    function createUrl(path: string, hubName: string): string {
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      return normalizeUrl(`${protocol}://${webServer.replace('http://', '')}/hub_api/pyls/${hubName}${path}`, {stripWWW: false});
    }

    function createWebSocket(url: string): WebSocket {
      const socketOptions = {
        maxReconnectionDelay: 10000,
        minReconnectionDelay: 1000,
        reconnectionDelayGrowFactor: 1.3,
        connectionTimeout: 10000,
        maxRetries: Infinity,
        debug: false,
      };
      // @ts-ignore
      return new ReconnectingWebSocket(url, undefined, socketOptions);
    }

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
import { ConsolePanel } from '@jupyterlab/console';
import { IEditorServices } from '@jupyterlab/codeeditor';
import { IFileBrowserFactory } from '@jupyterlab/filebrowser';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import * as pathToRegexp from 'path-to-regexp';
import { request } from '@jupyterlab/services';
// import { find } from '@phosphor/algorithm';

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
  requires: [
    ICommandPalette,
    ConsolePanel.IContentFactory,
    IEditorServices,
    ILayoutRestorer,
    IFileBrowserFactory,
    IRenderMimeRegistry,
    IConsoleTracker,
  ],
  activate: (app: JupyterLab, palette: ICommandPalette, contentFactory: ConsolePanel.IContentFactory,
             editorServices: IEditorServices, restorer: ILayoutRestorer, browserFactory: IFileBrowserFactory,
             rendermime: IRenderMimeRegistry, tracker: IConsoleTracker) => {
    // const manager = app.serviceManager;
    // const { commands } = app;
    // const tracker = new InstanceTracker<ConsolePanel>({ namespace: 'console' });

    function openConsole(args: Partial<ConsolePanel.IOptions>) {
      const manager = app.serviceManager;
      const { shell } = app;

      // Create an instance tracker for all console panels.
      // const tracker = new InstanceTracker<ConsolePanel>({ namespace: 'console' });

      interface ICreateOptions extends Partial<ConsolePanel.IOptions> {
        ref?: string;
        insertMode?: DockLayout.InsertMode;
      }

      /**
       * Create a console for a given path.
       */
      function createConsole(options: ICreateOptions): Promise<ConsolePanel> {

        let panel: ConsolePanel;
        return manager.ready.then(() => {
          panel = new ConsolePanel({
            manager,
            contentFactory,
            mimeTypeService: editorServices.mimeTypeService,
            rendermime,
            ...options as Partial<ConsolePanel.IOptions>,
          });

          return panel.session.ready;
        }).then(() => {
          // Add the console panel to the tracker.
          (tracker as InstanceTracker<ConsolePanel>).add(panel);
          shell.addToMainArea(
            panel, {
              ref: options.ref || null, mode: options.insertMode || 'split-bottom',
            },
          );
          shell.activateById(panel.id);
          return panel;
        });
      }

      // let path = args['path'];
      // let pathWidget = (tracker as InstanceTracker<ConsolePanel>).find(value => {
      //   return value.console.session.path === path;
      // });
      // let bottomWidget = (tracker as InstanceTracker<ConsolePanel>).find(value => {
      //   console.log('value', value);
      //   return value.node.offsetTop > 30;
      // });
      // if (bottomWidget) {
      //   console.log('bottomWidget', bottomWidget);
      //   console.log('currentWidget1', shell.currentWidget);
      //   // shell.activateById(bottomWidget.id);
      //   bottomWidget.node.click();
      //   bottomWidget.node.focus();
      //   console.log('currentWidget2', shell.currentWidget);
      //   args['insertMode'] = 'tab-after';
      // }
      // console.log('widget', pathWidget);
      // if (pathWidget && pathWidget.node.offsetTop > 30) {
      //   shell.activateById(pathWidget.id);
      //   return Promise.resolve(pathWidget);
      // } else {
      //   return manager.ready.then(() => {
      //     return createConsole(args);
      //   });
      // }
      let bottomWidget = (tracker as InstanceTracker<ConsolePanel>).find(value => {
        return value.node.offsetTop > 30;
      });
      if (bottomWidget) {
        shell.activateById(bottomWidget.id);
        return Promise.resolve(bottomWidget);
      } else {
        return manager.ready.then(() => {
          return createConsole(args);
        });
      }
    }

    // /**
    //  * Create a toExecutable toolbar item.
    //  */
    // function createRunButton(context: DocumentRegistry.CodeContext): ToolbarButton {
    //
    //   return new ToolbarButton({
    //     className: TOOLBAR_RUN_CLASS,
    //     onClick: () => {
    //       // const { commands } = app;
    //       const options = {
    //         name: `Run: Python`,
    //         path: context.path,
    //         preferredLanguage: context.model.defaultKernelLanguage,
    //         kernelPreference: { name: 'python3' },
    //         insertMode: 'split-bottom',
    //       };
    //
    //       openConsole(options)
    //         .then((consolePanel) => {
    //           const { console: currentConsole } = consolePanel;
    //           let promptCell = currentConsole.promptCell;
    //           if (!promptCell) {
    //             return;
    //           }
    //           let model = promptCell.model;
    //           model.value.text = `!python ${context.contentsModel.name}`;
    //           currentConsole.execute(true);
    //         });
    //     },
    //     tooltip: 'Run Script',
    //   });
    // }

    /**
     * Create a toExecutable toolbar item.
     */
    function createMDButton(context: DocumentRegistry.CodeContext): ToolbarButton {

      return new ToolbarButton({
        className: 'jp-MarkdownIcon',
        onClick: () => {
          const { commands } = app;
          const options = {
            path: context.path,
            options: { mode: 'split-right' },
          };
          commands.execute('markdownviewer:open', options);
        },
        tooltip: 'Markdown Preview',
      });
    }

    /**
     * Create a toExecutable toolbar item.
     */
    function createSaveButton(context: DocumentRegistry.CodeContext): ToolbarButton {

      return new ToolbarButton({
        className: 'jp-SaveIcon',
        onClick: () => {
          const { commands } = app;
          const options = {
            path: context.path,
            options: { mode: 'split-right' },
          };
          commands.execute('docmanager:save', options);
        },
        tooltip: 'Save your file.',
      });
    }

    /**
     * Create a Collaboration toolbar item.
     */
    function createCollabButton(context: DocumentRegistry.CodeContext): ToolbarButton {
      const hash = window.location.hash;
      const match = pathToRegexp('#/workspace/:projectId/:type/:classroom').exec(hash);
      // this._text = new ToolbarButton({
      //   className: 'jp-CollaborationIcon',
      // });
      const button = new ToolbarButton({
        className: 'jp-CollaborationIcon',
        // onClick: () => {},
        // tooltip: 'Insert Code Snippets',
      });
      request(`pyapi/project/file_locker/${match[1]}?file_path=${context.path}&type=${match[2]}`, {
          method: 'get',
          headers: {
            'Authorization': 'Bearer ' + localStorage.getItem('token'),
          },
        },
        {
          onJson: (res: any) => {
            if (res.is_locked) {
              const { user } = res;
              Modal.warning({
                title: 'This file is editing by other collaborator!',
                content: `${user.username} is editing this file, please come back later or contact with him/her.`,
              });
              // this._text.node.style.display = 'block';
              // this._text.node.innerText = `${user.username} is editing...`;
              // this._text.node.style.textTransform = 'none';
              // this._text.node.style.width = '100px';
              // this._text.node.style.fontSize = '12px';
              // this._button.node. = 'block';

              button.node.style.display = 'block';
              button.node.style.backgroundImage = `url(${user.avatar_url || `/pyapi/user/avatar/${user.user_ID}.jpeg`})`;
              button.node.style.backgroundSize = 'cover';
              button.node.style.borderRadius = '50%';
              button.node.style.width = '24px';
              button.node.style.height = '24px';
              button.node.title = `${user.username} is editing...`;
              button.node.onclick = () => window.open(`/#/profile/${user.user_ID}`);
            }
          },
        });
      return button;
    }


    function changeType(e,queuingNumber,runningNumber){
      if (e.target.value==='notebook'){
        document.getElementById('Notice').innerText=``
      }
      else if(e.target.value==='cpu')
        document.getElementById('Notice').innerText=`Notice: You have ${runningNumber} jobs are running.`
      else if(e.target.value==='gpu'){
        document.getElementById('Notice').innerText=`Notice: You have ${queuingNumber} jobs are queuing,  ${runningNumber} jobs are running.`
      }
    }

    class SelectEnv extends Widget {
      constructor(user_ID, gpu_time_limit,projectId, projectType,email_verified, gpuFirst) {
        let body = document.createElement('div');
        let nameDiv = document.createElement('div');
        let nameInput = document.createElement('input');

        let queuingNumber = 0
        let runningNumber = 0

        nameInput.className = 'monaco-job-name-input';
        nameInput.placeholder = '(Optional) Enter job name';
        nameInput.id = 'monaco-job-name-input';
        nameInput.style.marginBottom = '10px';
        nameDiv.appendChild(nameInput);
        body.appendChild(nameDiv);
        // let envLabel = document.createElement('h3');
        // envLabel.textContent = 'Choose running env: ';
        // body.appendChild(envLabel);

        [['notebook', 'Notebook Console'],
          ['cpu', 'CPU Only Machines']].forEach(([value, label]) => {
          let div = document.createElement('div');
          let existingLabel = document.createElement('label');
          existingLabel.textContent = label;
          existingLabel.htmlFor = value;
          let input = document.createElement('input');
          if (value === 'notebook') {
            input.checked = true;
          }
          input.value = value;
          input.name = 'env-radio';
          input.className = 'env-radio';
          input.id = value;
          input.style.marginRight = '10px';
          input.type = 'radio';
          input.onclick = (e)=>changeType(e,queuingNumber,runningNumber);
          div.style.display = 'flex';
          div.style.alignItems = 'center';
          div.style.padding = '5px 5px';
          div.appendChild(input);
          div.appendChild(existingLabel);
          body.appendChild(div);
        });

        const gpu_hour = gpu_time_limit ? Math.floor(gpu_time_limit / 3600) : 0;
        const gpu_minutes = gpu_time_limit ? Math.round((gpu_time_limit - gpu_hour * 3600) / 60) : 0;

        let div1 = document.createElement('div');
        let existingLabel = document.createElement('label');
        existingLabel.textContent = `GPU Powered Machines (剩余 ${gpu_hour} 小时, ${gpu_minutes} 分钟)`;
        existingLabel.htmlFor = 'gpu';
        let input = document.createElement('input');
        input.value = 'gpu';
        input.name = 'env-radio';
        input.className = 'env-radio';
        input.id = 'gpu';
        input.style.marginRight = '10px';
        input.type = 'radio';
        input.onclick = (e)=>changeType(e,queuingNumber,runningNumber);
        if (gpu_time_limit < 0 || !email_verified) {
          input.disabled = true;
        }
        if(gpu_time_limit > 0 && email_verified && gpuFirst){
          input.checked = true;
        }
        div1.style.display = 'flex';
        div1.style.alignItems = 'center';
        div1.style.padding = '5px 5px';
        div1.appendChild(input);
        div1.appendChild(existingLabel);
        body.appendChild(div1);
        let div2 = document.createElement('div');
        let invite = document.createElement('a');
        if (email_verified){
          invite.textContent = `邀请好友获得更多免费GPU使用时间`;
          invite.href = `/#/event`;
          invite.target = '_blank';
        }
        else{
          invite.textContent = `激活邮箱以获得 GPU 使用权限`;
          invite.href = `/#/setting/profile/${user_ID}`;
          invite.target = '_blank';
        }


        div2.style.display = 'flex';
        div2.style.alignItems = 'center';
        div2.style.padding = '5px 5px 5px 28px';
        div2.appendChild(invite);
        body.appendChild(div2);
        let div3 = document.createElement('div');
        let notice = document.createElement('div');
        notice.textContent = ``;
        notice.id = 'Notice';
        if(gpu_time_limit > 0 && email_verified && gpuFirst){
          notice.textContent = `Notice: You have ${queuingNumber} jobs are queuing,  ${runningNumber} jobs are running.`
        }
        div3.style.padding = '5px 5px';
        div3.style.color = 'grey';
        div3.appendChild(notice);
        body.appendChild(div3);

        let b = getUserJobs({ projectId, projectType, status: 'Queuing' });
        // get User queueing jobs
        let c = getUserJobs({ projectId, projectType, status: 'Running' });

        Promise.all([b, c]).then(([res2, res3]) => {
          queuingNumber = res2.data.count;
          runningNumber = res3.data.count;
          document.getElementById('cpu').onclick = (e)=>changeType(e,queuingNumber,runningNumber);
          document.getElementById('gpu').onclick = (e)=>changeType(e,queuingNumber,runningNumber);
        })
        super({ node: body });
      }

      onAfterAttach() {
        let inputs = this.node.getElementsByTagName('input');
        console.log('sssss',inputs, name);
        for (let inp of inputs as any) {
          if (inp.id !== 'monaco-job-name-input') {
            inp.className = 'env-radio';
          }
        }
        // inputs.forEach((inp) => {
        //   inp.className = '';
        // });
      }

      getValue(): string[] {
        let inputs = this.node.getElementsByTagName('input');
        const name = (document.getElementById('monaco-job-name-input') as HTMLInputElement).value;
        console.log(inputs, name);

        for (let inp of inputs as any) {
          if (inp.checked) {
            return [inp.value, name];
          }
        }
        return ['notebook', undefined];
      }
    }

    /**
     * Create a toExecutable toolbar item.
     */
    function createLongRunButton(context: DocumentRegistry.CodeContext): ToolbarButton {
      return new ToolbarButton({
        className: TOOLBAR_RUN_CLASS,
        onClick: () => {
          const { commands } = app;
          const options = {
            path: context.path,
            options: { mode: 'split-right' },
          };
          commands.execute('docmanager:save', options);
          const user_ID = localStorage.getItem('user_ID');
          const hash = window.location.hash;
          const match = pathToRegexp('#/workspace/:projectId/:type/:classroom').exec(hash);
          // console.log('user_ID...', user_ID);

          let projectId = match[1];
          let projectType = match[2];
          let gpu_time_limit = 0;
          let email_verified = false
          // let queuingNumber = 0;
          // let runningNumber = 0;

          let a = getUserInfo({ user_ID })

          // let b = getUserJobs({ projectId, projectType, status: 'Queuing' });
          // get User queueing jobs
          // let c = getUserJobs({ projectId, projectType, status: 'Running' });

          Promise.all([a]).then(([res1]) => {
            email_verified = res1.data.email_verified;
            gpu_time_limit = res1.data.gpu_time_limit || 0;
            // queuingNumber = res2.data.count;
            // runningNumber = res3.data.count;
            // console.log('gpu_time_limit...', gpu_time_limit);
            showDialog({
              title: 'Choose an environment to run your job:',
              body: new SelectEnv(user_ID, gpu_time_limit, projectId, projectType,email_verified,false),
              focusNodeSelector: 'input',
              buttons: [Dialog.cancelButton(), Dialog.okButton({ accept: true, label: 'CREATE' })],
            }).then(result => {
              if (result.button.label === 'CANCEL') {
                return;
              }
              if (!result.value) {
                return null;
              }
              if (result.value[0] === 'notebook') {
                const options = {
                  name: `Run: ${result.value[1] ? result.value[1] : 'Python'}`,
                  path: context.path,
                  preferredLanguage: context.model.defaultKernelLanguage,
                  kernelPreference: { name: 'python3' },
                  insertMode: 'split-bottom',
                };
                openConsole(options)
                  .then((consolePanel) => {
                    const { console: currentConsole } = consolePanel;
                    let promptCell = currentConsole.promptCell;
                    if (!promptCell) {
                      return;
                    }
                    let model = promptCell.model;
                    model.value.text = `!python ${context.contentsModel.name}`;
                    currentConsole.execute(true);
                  });
                return;
              }
              const hash = window.location.hash;
              const match = pathToRegexp('#/workspace/:projectId/:type').exec(hash);
              if (match) {
                const projectId = match[1];
                const type = match[2];
                const scriptPath = context.path;
                const hide = message.loading((window as any).intl.formatMessage(
                  {id: 'notebook.job.creating'},
                  {defaultMessage: 'Job creating...'}
                ), 0);
                createJob({
                  projectId, type, scriptPath, env: result.value[0], displayName: result.value[1], onJson: (res) => {
                    console.log('jobres', res)
                    if(res['is_error']){
                      message.error(
                          (window as any).intl.formatMessage(
                              {id: 'notebook.job.createdError'},
                              {defaultMessage: 'Job error.'}
                          )
                      );
                      app.shell.activateById('logs-manager');
                    } else {
                      message.success(
                          (window as any).intl.formatMessage(
                              {id: 'notebook.job.created'},
                              {defaultMessage: 'Job created.'}
                          )
                      );
                      app.shell.activateById('jobs-manager');
                    }

                    hide();
                  },
                });
              }
            });
          });
          // console.log('gpu_time_limit111...', gpu_time_limit);
        },
        tooltip: 'Create Job',
      });
    }



    // /**
    //  * Create a toExecutable toolbar item.
    //  */
    // function createGpuRunButton(context: DocumentRegistry.CodeContext): ToolbarButton {
    //   return new ToolbarButton({
    //     className: TOOLBAR_GPU_RUN_CLASS,
    //     onClick: () => {
    //       const { commands } = app;
    //       const options = {
    //         path: context.path,
    //         options: { mode: 'split-right' },
    //       };
    //       commands.execute('docmanager:save', options);
    //       const user_ID = localStorage.getItem('user_ID');
    //       const hash = window.location.hash;
    //       const match = pathToRegexp('#/workspace/:projectId/:type').exec(hash);
    //       // console.log('user_ID...', user_ID);
    //
    //       let projectId = match[1];
    //       let projectType = match[2];
    //       let gpu_time_limit = 0;
    //       let email_verified = false
    //       // let queuingNumber = 0;
    //       // let runningNumber = 0;
    //
    //       let a = getUserInfo({ user_ID })
    //
    //       // let b = getUserJobs({ projectId, projectType, status: 'Queuing' });
    //       // get User queueing jobs
    //       // let c = getUserJobs({ projectId, projectType, status: 'Running' });
    //
    //       Promise.all([a]).then(([res1]) => {
    //         email_verified = res1.data.email_verified;
    //         gpu_time_limit = res1.data.gpu_time_limit || 0;
    //         // queuingNumber = res2.data.count;
    //         // runningNumber = res3.data.count;
    //         // console.log('gpu_time_limit...', gpu_time_limit);
    //         showDialog({
    //           title: 'Choose an environment to run your job:',
    //           body: new SelectEnv(user_ID, gpu_time_limit, projectId, projectType,email_verified, true),
    //           focusNodeSelector: 'input',
    //           buttons: [Dialog.cancelButton(), Dialog.okButton({ accept: true, label: 'CREATE' })],
    //         }).then(result => {
    //           if (result.button.label === 'CANCEL') {
    //             return;
    //           }
    //           if (!result.value) {
    //             return null;
    //           }
    //           if (result.value[0] === 'notebook') {
    //             const options = {
    //               name: `Run: ${result.value[1] ? result.value[1] : 'Python'}`,
    //               path: context.path,
    //               preferredLanguage: context.model.defaultKernelLanguage,
    //               kernelPreference: { name: 'python3' },
    //               insertMode: 'split-bottom',
    //             };
    //             openConsole(options)
    //               .then((consolePanel) => {
    //                 const { console: currentConsole } = consolePanel;
    //                 let promptCell = currentConsole.promptCell;
    //                 if (!promptCell) {
    //                   return;
    //                 }
    //                 let model = promptCell.model;
    //                 model.value.text = `!python ${context.contentsModel.name}`;
    //                 currentConsole.execute(true);
    //               });
    //             return;
    //           }
    //           const hash = window.location.hash;
    //           const match = pathToRegexp('#/workspace/:projectId/:type').exec(hash);
    //           if (match) {
    //             const projectId = match[1];
    //             const type = match[2];
    //             const scriptPath = context.path;
    //             const hide = message.loading((window as any).intl.formatMessage(
    //               {id: 'notebook.job.creating'},
    //               {defaultMessage: 'Job creating...'}
    //             ), 0);
    //             createJob({
    //               projectId, type, scriptPath, env: result.value[0], displayName: result.value[1], onJson: (res) => {
    //                 // console.log('jobres', res)
    //                 if(res['is_error']){
    //                   message.error(
    //                     (window as any).intl.formatMessage(
    //                       {id: 'notebook.job.createdError'},
    //                       {defaultMessage: 'Job error.'}
    //                     )
    //                   );
    //                   app.shell.activateById('logs-manager');
    //                 } else {
    //                   message.success(
    //                     (window as any).intl.formatMessage(
    //                       {id: 'notebook.job.created'},
    //                       {defaultMessage: 'Job created.'}
    //                     )
    //                   );
    //                   app.shell.activateById('jobs-manager');
    //                 }
    //
    //                 hide();
    //               },
    //             });
    //           }
    //         });
    //       });
    //       // console.log('gpu_time_limit111...', gpu_time_limit);
    //     },
    //     tooltip: 'Create GPU Job',
    //   });
    // }

    /**
     * A document widget for editors.
     */
    class MonacoFileEditor extends Widget implements DocumentRegistry.IReadyWidget {
      /**
       * Construct a new editor widget.
       */
      constructor(context: DocumentRegistry.CodeContext) {
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
        const ext = context.path.split('.').slice(-1)[0];
        let toolbar = new Toolbar();
        toolbar.addClass('jp-MonacoPanel-toolbar');
        toolbar.addItem('Save', createSaveButton(context));
        if (['py', 'md'].includes(ext)) {
          if (ext === 'py') {
            // toolbar.addItem('Run', createRunButton(context));
            toolbar.addItem('Create Job', createLongRunButton(context));
            // toolbar.addItem('Create GPU Job', createGpuRunButton(context));
          }
          if (ext === 'md') {
            toolbar.addItem('Markdown Preview', createMDButton(context));
          }
        }
        toolbar.addItem('Space', Toolbar.createSpacerItem());
        toolbar.addItem('collaboration', createCollabButton(context));

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
     * A widget factory for editors.
     */
    class MonacoEditorFactory extends ABCWidgetFactory<MonacoFileEditor, DocumentRegistry.ICodeModel> {
      /**
       * Construct a new editor widget factory.
       */
      constructor(options: MonacoEditorFactory.IOptions) {
        super(options.factoryOptions);
      }

      /**
       * Create a new widget given a context.
       */
      protected createNewWidget(context: DocumentRegistry.CodeContext): MonacoFileEditor {
        return new MonacoFileEditor(context);
      }
    }

    const factory = new MonacoEditorFactory(
      {
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
      execute: (args) => {
        const path = args['path'] as string || void 0;
        const factory = args['factory'] as string || void 0;
        let widget = browserFactory.defaultBrowser.model.manager.openOrReveal(path, factory);
        app.shell.addToMainArea(widget);
        // Activate the widget
        app.shell.activateById(widget.id);
        return widget;
      },
    });

    // Add the command to the palette.
    palette.addItem({ command, category: 'Monaco' });

  },
};

export default extension;
