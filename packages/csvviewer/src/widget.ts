// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import * as dsv from 'd3-dsv';

import {
  ActivityMonitor, PathExt
} from '@jupyterlab/coreutils';

import {
  ABCWidgetFactory, DocumentRegistry
} from '@jupyterlab/docregistry';

import {
  PromiseDelegate
} from '@phosphor/coreutils';

import {
  DataGrid, JSONModel
} from '@phosphor/datagrid';

import {
  Message
} from '@phosphor/messaging';

import {
  PanelLayout, Widget
} from '@phosphor/widgets';

import {
  CSVToolbar
} from './toolbar';


/**
 * The class name added to a CSV viewer.
 */
const CSV_CLASS = 'jp-CSVViewer';

/**
 * The class name added to a CSV viewer toolbar.
 */
const CSV_VIEWER_CLASS = 'jp-CSVViewer-toolbar';

/**
 * The class name added to a CSV viewer datagrid.
 */
const CSV_GRID_CLASS = 'jp-CSVViewer-grid';

/**
 * The timeout to wait for change activity to have ceased before rendering.
 */
const RENDER_TIMEOUT = 1000;


/**
 * A viewer for CSV tables.
 */
export
class CSVViewer extends Widget implements DocumentRegistry.IReadyWidget {
  /**
   * Construct a new CSV viewer.
   */
  constructor(options: CSVViewer.IOptions) {
    super();

    let context = this._context = options.context;
    let layout = this.layout = new PanelLayout();

    this.addClass(CSV_CLASS);
    this.title.label = PathExt.basename(context.path);

    this._grid = new DataGrid();
    this._grid.addClass(CSV_GRID_CLASS);
    this._grid.headerVisibility = 'column';

    this._toolbar = new CSVToolbar({ selected: this._delimiter });
    this._toolbar.delimiterChanged.connect(this._onDelimiterChanged, this);
    this._toolbar.addClass(CSV_VIEWER_CLASS);
    layout.addWidget(this._toolbar);
    layout.addWidget(this._grid);

    context.pathChanged.connect(this._onPathChanged, this);

    this._context.ready.then(() => {
      this._updateGrid();
      this._ready.resolve(undefined);
      // Throttle the rendering rate of the widget.
      this._monitor = new ActivityMonitor({
        signal: context.model.contentChanged,
        timeout: RENDER_TIMEOUT
      });
      this._monitor.activityStopped.connect(this._updateGrid, this);
    });
  }

  /**
   * The CSV widget's context.
   */
  get context(): DocumentRegistry.Context {
    return this._context;
  }

  /**
   * A promise that resolves when the csv viewer is ready.
   */
  get ready() {
    return this._ready.promise;
  }

  /**
   * Dispose of the resources used by the widget.
   */
  dispose(): void {
    if (this._monitor) {
      this._monitor.dispose();
    }
    super.dispose();
  }

  /**
   * Handle `'activate-request'` messages.
   */
  protected onActivateRequest(msg: Message): void {
    this.node.tabIndex = -1;
    this.node.focus();
  }

  /**
   * Handle a change in delimiter.
   */
  private _onDelimiterChanged(sender: CSVToolbar, delimiter: string): void {
    this._delimiter = delimiter;
    this._updateGrid();
  }

  /**
   * Handle a change in path.
   */
  private _onPathChanged(): void {
    this.title.label = PathExt.basename(this._context.path);
  }

  /**
   * Create the json model for the grid.
   */
  private _updateGrid(): void {
    let text = this._context.model.toString();
    let [columns, data] = Private.parse(text, this._delimiter);
    let fields = columns.map(name => ({ name, type: 'string' }));
    this._grid.model = new JSONModel({ data, schema: { fields } });
  }

  private _context: DocumentRegistry.Context;
  private _grid: DataGrid;
  private _toolbar: CSVToolbar;
  private _monitor: ActivityMonitor<any, any> | null = null;
  private _delimiter = ',';
  private _ready = new PromiseDelegate<void>();
}


/**
 * A namespace for `CSVViewer` statics.
 */
export
namespace CSVViewer {
  /**
   * Instantiation options for CSV widgets.
   */
  export
  interface IOptions {
    /**
     * The document context for the CSV being rendered by the widget.
     */
    context: DocumentRegistry.Context;
  }
}


/**
 * A widget factory for CSV widgets.
 */
export
class CSVViewerFactory extends ABCWidgetFactory<CSVViewer, DocumentRegistry.IModel> {
  /**
   * Create a new widget given a context.
   */
  protected createNewWidget(context: DocumentRegistry.Context): CSVViewer {
    return new CSVViewer({ context });
  }
}


/**
 * The namespace for the module implementation details.
 */
namespace Private {
  /**
   * Parse DSV text with the given delimiter.
   *
   * @param text - The DSV text to parse.
   *
   * @param delimiter - The delimiter for parsing.
   *
   * @returns A tuple of `[columnNames, dataRows]`
   */
  export
  function parse(text: string, delimiter: string): [string[], dsv.DSVRowString[]] {
    let columns: string[] = [];
    let rowFn: RowFn | null = null;
    let rows = dsv.dsvFormat(delimiter).parseRows(text, row => {
      if (rowFn) return rowFn(row);
      columns = uniquifyColumns(row);
      rowFn = makeRowFn(columns);
    });
    return [columns, rows];
  }

  /**
   * Replace duplicate column names with unique substitutes.
   */
  function uniquifyColumns(columns: string[]): string[] {
    let unique: string[] = [];
    let set: { [key: string]: boolean } = Object.create(null);
    for (let name of columns) {
      let uniqueName = name;
      for (let i = 1; uniqueName in set; ++i) {
        uniqueName = `${name}.${i}`;
      }
      set[uniqueName] = true;
      unique.push(uniqueName);
    }
    return unique;
  }

  /**
   * A type alias for a row conversion function.
   */
  type RowFn = (r: string[]) => dsv.DSVRowString;

  /**
   * Create a row conversion function for the given column names.
   */
  function makeRowFn(columns: string[]): RowFn {
    let pairs = columns.map((name, i) => `'${name}':r[${i}]`).join(',');
    return (new Function('r', `return {${pairs}};`)) as RowFn;
  }
}
