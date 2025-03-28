/** @decorator */

import ppp from '../../ppp.js';
import {
  html,
  css,
  ref,
  when,
  observable,
  Updates,
  attr,
  Observable
} from '../../vendor/fast-element.min.js';
import { Page, pageStyles } from '../page.js';
import { Denormalization } from '../../lib/ppp-denormalize.js';
import {
  emptyState,
  hotkey,
  scrollbars,
  typography
} from '../../design/styles.js';
import {
  paletteGrayDark4,
  paletteGrayLight2,
  scrollBarSize,
  themeConditional
} from '../../design/design-tokens.js';
import { dragAndDrop } from '../../static/svg/sprite.js';
import { uuidv4 } from '../../lib/ppp-crypto.js';
import '../button.js';
import '../empty-workspace-gizmo.js';
import '../top-loader.js';

export const workspacePageTemplate = html`
  <template class="${(x) => x.generateClasses()}">
    <ppp-top-loader ${ref('topLoader')}></ppp-top-loader>
    <ppp-loader></ppp-loader>
    <form novalidate>
      ${when(
        (x) => x.isSteady() && !x.document.widgets?.length,
        html`
          ${when(
            () => !ppp.settings.get('hideEmptyWorkspaceGizmo'),
            html` <ppp-empty-workspace-gizmo></ppp-empty-workspace-gizmo> `
          )}
          <div class="empty-state">
            <div class="picture">${html.partial(dragAndDrop)}</div>
            <h3>В этом терминале нет виджетов</h3>
            <p>
              Перед тем, как начать торговать, разместите виджеты на рабочей
              области. Чтобы в дальнейшем добавлять виджеты, выберите терминал в
              боковом меню и нажмите&nbsp;<code
                @click="${() => ppp.app.showWidgetSelector()}"
                class="hotkey"
                >+W</code
              >
            </p>
            <ppp-button
              appearance="primary"
              class="large"
              @click="${() => ppp.app.showWidgetSelector()}"
            >
              Разместить виджет
            </ppp-button>
          </div>
        `
      )}
      ${when(
        (x) => x.isSteady() && x.document.widgets?.length,
        html` <div class="workspace" ${ref('workspace')}></div> `
      )}
    </form>
  </template>
`;

export const workspacePageStyles = css`
  ${pageStyles}
  ${hotkey()}
  ${typography()}
  ${emptyState()}
  ${scrollbars('.workspace')}
  :host {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .workspace {
    position: relative;
    z-index: 1;
    overflow-y: auto;
    background-color: ${themeConditional(paletteGrayLight2, paletteGrayDark4)};
    width: 100%;
    height: 100%;
  }

  .workspace::-webkit-scrollbar {
    width: calc(${scrollBarSize} * 2px);
    height: calc(${scrollBarSize} * 2px);
  }

  .widget {
    contain: layout;
    position: absolute;
    overflow: initial;
  }

  :host([frozen]) .widget {
    pointer-events: none;
    opacity: 0.75;
  }

  .empty-state .picture svg {
    width: 110px;
  }
`;

export class WorkspacePage extends Page {
  @attr({ mode: 'boolean' })
  dragging;

  @attr({ mode: 'boolean' })
  resizing;

  @attr({ mode: 'boolean' })
  frozen;

  @observable
  workspace;

  // Use this to trigger getWidgetNameWhenStacked().
  @observable
  lastWidgetSubmissionTime;

  collection = 'workspaces';

  zIndex = 10;

  denormalization = new Denormalization();

  get widgets() {
    return Array.from(this.shadowRoot.querySelectorAll('.widget'));
  }

  constructor() {
    super();

    this.document.widgets = [];
    this.lastWidgetSubmissionTime = Date.now();

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onDblClick = this.onDblClick.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
  }

  getWidgetNameWhenStacked(uniqueID) {
    return (
      this.lastWidgetSubmissionTime &&
      (this.widgets.find((w) => w.document.uniqueID === uniqueID)?.document
        .nameWhenStacked ??
        '')
    );
  }

  async onKeyDown(event) {
    if (event.code === 'KeyA' && event.altKey) {
      this.frozen = true;
    }

    if (event.shiftKey) {
      if (event.code === 'KeyC' && this.workspace) {
        const selectedWidget = this.workspace.querySelector(
          ':is(.widget[dragging], .widget[resizing])'
        );

        if (selectedWidget) {
          this.topLoader.start();

          try {
            const { widgets } = await ppp.user.functions.findOne(
              { collection: 'workspaces' },
              {
                _id: this.document._id
              }
            );

            if (Array.isArray(widgets)) {
              ppp.app.widgetClipboard = {
                // From MongoDB
                savedDocument: widgets?.find(
                  (w) => w.uniqueID === selectedWidget.document.uniqueID
                ),
                // Denormalized one, used for placement
                liveDocument: Object.assign({}, selectedWidget.document)
              };

              if (ppp.app.widgetClipboard.savedDocument) {
                this.showSuccessNotification(
                  `Виджет «${selectedWidget.document.name}» скопирован в буфер обмена.`
                );
              }
            }
          } catch (e) {
            console.error(e);
          } finally {
            this.topLoader.stop();
          }
        }
      } else if (event.code === 'KeyV' && ppp.app.widgetClipboard) {
        const { savedDocument, liveDocument } = ppp.app.widgetClipboard;

        savedDocument.x = void 0;
        savedDocument.y = void 0;
        savedDocument.activeWidgetLink = void 0;
        savedDocument.linkedWidgets = void 0;
        liveDocument.x = void 0;
        liveDocument.y = void 0;
        liveDocument.activeWidgetLink = void 0;
        liveDocument.linkedWidgets = void 0;
        liveDocument.symbol = savedDocument.symbol;

        savedDocument.uniqueID = uuidv4();
        liveDocument.uniqueID = savedDocument.uniqueID;

        this.document.widgets.push(liveDocument);
        this.document.widgets[this.document.widgets.length - 1].zIndex =
          this.zIndex + 1;

        Observable.notify(this, 'document');

        this.locked = true;
        ppp.app.widgetClipboard = null;

        Updates.enqueue(async () => {
          try {
            const widgetElement = await this.placeWidget(liveDocument);

            await ppp.user.functions.updateOne(
              {
                collection: 'workspaces'
              },
              {
                _id: this.document._id
              },
              {
                $push: {
                  widgets: Object.assign(savedDocument, {
                    x: liveDocument.x,
                    y: liveDocument.y,
                    zIndex: liveDocument.zIndex
                  })
                }
              }
            );

            widgetElement.setAttribute('placed', '');
          } finally {
            this.locked = false;
          }
        });
      }
    }
  }

  async onKeyUp(event) {
    if (event.code === 'KeyA') {
      this.frozen = false;
    }
  }

  async submitDocument() {
    // No-op.
  }

  draggingChanged(oldValue, newValue) {
    this.widgets.forEach((w) =>
      newValue ? w.setAttribute('frozen', '') : w.removeAttribute('frozen')
    );
  }

  resizingChanged(oldValue, newValue) {
    this.widgets.forEach((w) =>
      newValue ? w.setAttribute('frozen', '') : w.removeAttribute('frozen')
    );
  }

  onPointerDown(event) {
    let resizeControls;
    let isFromHeader = false;
    let isFromHeaderControl = false;
    const cp = event.composedPath();

    for (const n of cp) {
      const cl = n?.classList;

      if (cl?.contains('widget-header')) {
        isFromHeader = true;
      }

      if (
        cl?.contains('widget-header-control') ||
        /modal|ppp-widget-group-control|ppp-widget-search-control|ppp-widget-header-buttons/i.test(
          n?.tagName
        )
      ) {
        isFromHeaderControl = true;

        break;
      }
    }

    if (isFromHeader && !isFromHeaderControl) {
      this.dragging = true;
    } else if (
      (resizeControls = cp.find(
        (n) => n?.tagName?.toLowerCase?.() === 'ppp-widget-resize-controls'
      ))
    ) {
      this.resizeControls = resizeControls;
      this.resizing = true;
    }

    if (this.dragging || this.resizing) {
      const widget = cp.find((n) => n?.classList?.contains('widget'));

      if (widget?.locked) {
        this.dragging = false;
        this.resizing = false;

        return;
      }

      if (widget) {
        // Initial coordinates for deltas.
        this.clientX = event.clientX;
        this.clientY = event.clientY;
        // Side nav offset.
        this.x = this.getBoundingClientRect().x;

        widget.dragging = this.dragging;
        widget.resizing = this.resizing;

        this.rectangles = this.widgets
          .filter((w) => w !== widget)
          .map((w) => {
            const { width, height } = w.getBoundingClientRect();
            let { left, top } = getComputedStyle(w);

            left = parseInt(left) + this.x;
            top = parseInt(top);

            return {
              top,
              right: left + width,
              bottom: top + height,
              left,
              width,
              height,
              x: left,
              y: top
            };
          });

        this.rectangles.push({
          top: 0,
          right: this.x + this.workspace.scrollWidth,
          bottom: this.workspace.scrollHeight,
          left: this.x,
          width: this.workspace.scrollWidth,
          height: this.workspace.scrollHeight,
          x: this.x,
          y: 0
        });

        if (this.dragging) {
          this.draggedWidget = widget;

          const bcr = this.draggedWidget.getBoundingClientRect();
          const styles = getComputedStyle(widget);

          widget.x = parseInt(styles.left);
          widget.y = parseInt(styles.top);
          widget.width = bcr.width;
          widget.height = bcr.height;

          if (typeof this.draggedWidget.beforeDrag === 'function') {
            this.draggedWidget.beforeDrag();
          }
        } else if (this.resizing) {
          resizeControls.onPointerDown({ event, node: cp[0] });
        }
      }
    }
  }

  applySnapping({ widget, newTop, newRight, newBottom, newLeft }) {
    this.rectangles.forEach((rect) => {
      const hasVerticalIntersection =
        (newTop >= rect.top - this.snapDistance &&
          newTop <= rect.bottom + this.snapDistance) ||
        (newBottom >= rect.top - this.snapDistance &&
          newBottom <= rect.bottom + this.snapDistance) ||
        (newTop <= rect.top - this.snapDistance &&
          newBottom >= rect.bottom + this.snapDistance);

      if (hasVerticalIntersection) {
        // 1. Vertical, this.left -> rect.right
        const deltaLeftRight = Math.abs(
          newLeft - (rect.x - this.x + rect.width)
        );

        if (deltaLeftRight <= this.snapDistance) {
          newLeft = rect.x - this.x + rect.width + this.snapMargin;
        }

        // 2. Vertical, this.left -> rect.left
        const deltaLeftLeft = Math.abs(newLeft - (rect.x - this.x));

        if (deltaLeftLeft <= this.snapDistance) {
          newLeft = rect.x - this.x;
        }

        // 3. Vertical, this.right -> rect.right
        const deltaRightRight = Math.abs(
          newRight - (rect.x - this.x + rect.width)
        );

        if (deltaRightRight <= this.snapDistance) {
          newLeft = rect.x - this.x + rect.width - widget.width;
        }

        // 4. Vertical, this.right -> rect.left
        const deltaRightLeft = Math.abs(newRight - (rect.x - this.x));

        if (deltaRightLeft <= this.snapDistance) {
          newLeft = rect.x - this.x - widget.width - this.snapMargin;
        }
      }

      const hasHorizontalIntersection =
        (newLeft >= rect.left - this.x - this.snapDistance &&
          newLeft <= rect.right - this.x + this.snapDistance) ||
        (newRight >= rect.left - this.x - this.snapDistance &&
          newRight <= rect.right - this.x + this.snapDistance) ||
        (newLeft <= rect.left - this.x - this.snapDistance &&
          newRight >= rect.right - this.x + this.snapDistance);

      if (hasHorizontalIntersection) {
        // 1. Horizontal, this.top -> rect.bottom
        const deltaTopBottom = Math.abs(newTop - rect.bottom);

        if (deltaTopBottom <= this.snapDistance) {
          newTop = rect.bottom + this.snapMargin;
        }

        // 2. Horizontal, this.top -> rect.top
        const deltaTopTop = Math.abs(newTop - rect.y);

        if (deltaTopTop <= this.snapDistance) {
          newTop = rect.y;
        }

        // 3. Horizontal, this.bottom -> rect.bottom
        const deltaBottomBottom = Math.abs(
          rect.bottom - (newTop + widget.height)
        );

        if (deltaBottomBottom <= this.snapDistance) {
          newTop = rect.bottom - widget.height;
        }

        // 4. Horizontal, this.bottom -> rect.top
        const deltaBottomTop = Math.abs(rect.y - (newTop + widget.height));

        if (deltaBottomTop <= this.snapDistance) {
          newTop = rect.y - widget.height - this.snapMargin;
        }
      }
    });

    return { newTop, newRight, newBottom, newLeft };
  }

  onPointerMove(event) {
    if (this.dragging) {
      const deltaX = event.clientX - this.clientX;
      const deltaY = event.clientY - this.clientY;

      let { newTop, newLeft } = this.applySnapping({
        widget: this.draggedWidget,
        newTop: this.draggedWidget.y + deltaY,
        newRight: this.draggedWidget.x + deltaX + this.draggedWidget.width,
        newBottom: this.draggedWidget.y + deltaY + this.draggedWidget.height,
        newLeft: this.draggedWidget.x + deltaX
      });

      if (newLeft < 0) newLeft = 0;

      if (newTop < 0) newTop = 0;

      this.draggedWidget.style.left = `${newLeft}px`;
      this.draggedWidget.style.top = `${newTop}px`;

      if (typeof this.draggedWidget.onDrag === 'function') {
        this.draggedWidget.onDrag();
      }
    } else if (this.resizing) {
      this.resizeControls.onPointerMove({ event });
    }
  }

  onPointerUp(event) {
    if (this.dragging || this.resizing) {
      if (this.dragging) {
        void this.draggedWidget.updateDocumentFragment({
          $set: {
            'widgets.$.x': parseInt(this.draggedWidget.style.left),
            'widgets.$.y': parseInt(this.draggedWidget.style.top)
          }
        });

        this.draggedWidget.repositionLinkedWidgets(event.shiftKey);

        if (typeof this.draggedWidget.afterDrag === 'function') {
          this.draggedWidget.afterDrag();
        }

        this.draggedWidget = null;
      }

      if (this.resizing) {
        this.resizeControls.onPointerUp({ event });
      }

      this.rectangles = [];
      this.dragging = false;
      this.resizing = false;

      this.widgets.forEach((w) => {
        w.dragging = false;
        w.resizing = false;
      });
    }
  }

  async connectedCallback() {
    await super.connectedCallback();

    this.snapDistance = ppp.settings.get('workspaceSnapDistance') ?? 5;
    this.snapMargin = ppp.settings.get('workspaceSnapMargin') ?? 1;

    document.addEventListener('dblclick', this.onDblClick);
    document.addEventListener('pointerdown', this.onPointerDown);
    document.addEventListener('pointerup', this.onPointerUp);
    document.addEventListener('pointermove', this.onPointerMove);
    document.addEventListener('pointercancel', this.onPointerUp);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
  }

  disconnectedCallback() {
    document.removeEventListener('dblclick', this.onDblClick);
    document.removeEventListener('pointerdown', this.onPointerDown);
    document.removeEventListener('pointerup', this.onPointerUp);
    document.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('pointercancel', this.onPointerUp);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);

    super.disconnectedCallback();
  }

  onDblClick(event) {
    if (event.ctrlKey) {
      const value = !ppp.settings.get('sideNavVisible');

      ppp.settings.set('sideNavVisible', value);

      if (ppp.app.page === 'workspace')
        ppp.app.sideNav.style.display = value ? 'flex' : 'none';
    }
  }

  // Place widgets when DOM (.workspace) is ready
  async workspaceChanged(prev, next) {
    if (this.$fastController.isConnected && next) {
      this.beginOperation();

      try {
        const widgets = this.document.widgets ?? [];

        for (const w of widgets) {
          // Skip first widget added from modal
          if (!this.locked && typeof w.type !== 'undefined' && this.workspace) {
            await this.placeWidget(w);
          }
        }
      } catch (e) {
        this.failOperation(e, 'Загрузка терминала');
      } finally {
        this.endOperation();
      }
    }
  }

  async read() {
    return (context) => {
      return context.services
        .get('mongodb-atlas')
        .db('ppp')
        .collection('[%#this.collection%]')
        .aggregate([
          {
            $match: {
              _id: new BSON.ObjectId('[%#payload.documentId%]')
            }
          },
          {
            $project: {
              _id: 1,
              widgets: 1,
              name: 1,
              allowLockedWidgets: 1,
              ensembleMode: 1
            }
          },
          {
            $lookup: {
              from: 'widgets',
              localField: 'widgets._id',
              foreignField: '_id',
              as: 'denormalizedWidgets'
            }
          },
          {
            $lookup: {
              from: 'apis',
              pipeline: [
                {
                  $match: {
                    isolated: { $ne: true }
                  }
                },
                {
                  $project: {
                    updatedAt: 0,
                    createdAt: 0,
                    version: 0
                  }
                }
              ],
              as: 'apis'
            }
          },
          {
            $lookup: {
              from: 'traders',
              pipeline: [
                {
                  $match: {
                    isolated: { $ne: true }
                  }
                },
                {
                  $project: {
                    updatedAt: 0,
                    createdAt: 0,
                    version: 0
                  }
                }
              ],
              as: 'traders'
            }
          },
          {
            $lookup: {
              from: 'brokers',
              pipeline: [
                {
                  $match: {
                    isolated: { $ne: true }
                  }
                },
                {
                  $project: {
                    updatedAt: 0,
                    createdAt: 0,
                    version: 0
                  }
                }
              ],
              as: 'brokers'
            }
          },
          {
            $lookup: {
              from: 'bots',
              pipeline: [
                {
                  $match: {
                    isolated: { $ne: true }
                  }
                },
                {
                  $project: {
                    updatedAt: 0,
                    createdAt: 0,
                    version: 0,
                    webhook: 0,
                    type: 0
                  }
                }
              ],
              as: 'bots'
            }
          },
          {
            $lookup: {
              from: 'orders',
              pipeline: [
                {
                  $match: {
                    isolated: { $ne: true }
                  }
                },
                {
                  $project: {
                    updatedAt: 0,
                    createdAt: 0,
                    version: 0
                  }
                }
              ],
              as: 'orders'
            }
          },
          {
            $lookup: {
              from: 'services',
              pipeline: [
                {
                  $match: {
                    isolated: { $ne: true }
                  }
                },
                {
                  $project: {
                    updatedAt: 0,
                    createdAt: 0,
                    version: 0,
                    constsCode: 0,
                    formatterCode: 0,
                    instrumentsCode: 0,
                    symbolsCode: 0,
                    environmentCode: 0,
                    environmentCodeSecret: 0,
                    sourceCode: 0,
                    parsingCode: 0,
                    versioningUrl: 0,
                    useVersioning: 0,
                    tableSchema: 0,
                    insertTriggerCode: 0,
                    deleteTriggerCode: 0
                  }
                }
              ],
              as: 'services'
            }
          }
        ]);
    };
  }

  async transform() {
    const widgets = [];

    this.denormalization.fillRefs(this.document);

    for (const [, w] of this.document.widgets?.entries?.() ?? []) {
      // Prevent denormalized field
      for (const key in w) {
        if (w[key] === null && key.endsWith('Id')) {
          w[key.split('Id')[0]] = null;
        }
      }

      widgets.push(
        Object.assign(
          {
            apis: this.document.apis,
            traders: this.document.traders,
            brokers: this.document.brokers,
            bots: this.document.bots,
            orders: this.document.orders,
            services: this.document.services
          },
          // Denormalize widget template.
          await this.denormalization.denormalize(
            this.document.denormalizedWidgets.find(
              (widget) => widget._id === w._id
            )
          ),
          // Denormalize widget workspace data.
          await this.denormalization.denormalize(w)
        )
      );
    }

    return {
      _id: this.document._id,
      name: this.document.name,
      allowLockedWidgets: this.document.allowLockedWidgets ?? false,
      ensembleMode: this.document.ensembleMode ?? 'default',
      widgets
    };
  }

  getWidgetUrl(widget) {
    const type = widget.type;

    if (type === 'custom') {
      if (/https:\/\/psina\.pages\.dev/i.test(widget.url)) {
        const psinaBaseUrl =
          ppp.settings.get('psinaBaseUrl') ?? 'https://psina.pages.dev';

        widget.url = widget.url.replace(
          'https://psina.pages.dev',
          new URL(psinaBaseUrl).origin
        );
      }

      return new URL(widget.url).toString();
    } else {
      return `${ppp.rootUrl}/elements/widgets/${widget.type}.js`;
    }
  }

  async placeWidget(widgetDocument) {
    const url = await this.getWidgetUrl(widgetDocument);
    const module = await import(url);
    const wUrl = new URL(url);
    const baseWidgetUrl = wUrl.href.slice(0, wUrl.href.lastIndexOf('/'));

    widgetDocument.widgetDefinition = await module.widgetDefinition?.({
      ppp,
      baseWidgetUrl
    });

    const tagName = widgetDocument.widgetDefinition.customElement.name;
    const domElement = document.createElement(tagName);
    const minWidth = widgetDocument.widgetDefinition.minWidth ?? '275';
    const minHeight = widgetDocument.widgetDefinition.minHeight ?? '395';
    const widgetWidth = parseInt(
      widgetDocument.width ??
        widgetDocument.widgetDefinition.defaultWidth ??
        minWidth
    );
    const widgetHeight = parseInt(widgetDocument.height ?? minHeight);

    domElement.style.width = `${widgetWidth}px`;
    domElement.style.height = `${widgetHeight}px`;

    if (
      typeof widgetDocument.x === 'undefined' ||
      typeof widgetDocument.y === 'undefined'
    ) {
      const { scrollLeft, scrollTop } = this.workspace;
      const { width, height } = this.workspace.getBoundingClientRect();

      widgetDocument.x = Math.floor(width / 2 + scrollLeft - widgetWidth / 2);
      widgetDocument.y = Math.floor(height / 2 + scrollTop - widgetHeight / 2);
    }

    domElement.style.left = `${parseInt(widgetDocument.x ?? '0')}px`;
    domElement.style.top = `${parseInt(widgetDocument.y ?? '0')}px`;

    if (typeof widgetDocument.zIndex === 'number') {
      this.zIndex = Math.max(this.zIndex, widgetDocument.zIndex);

      domElement.style.zIndex = widgetDocument.zIndex;
    } else {
      domElement.style.zIndex = (++this.zIndex).toString();
    }

    domElement.widgetDefinition = widgetDocument.widgetDefinition;
    domElement.document = widgetDocument;

    return new Promise((resolve) => {
      Updates.enqueue(() => {
        domElement.container = this;
        domElement.topLoader = this.topLoader;
        domElement.classList.add('widget');

        widgetDocument.widgetElement = this.workspace.appendChild(domElement);
      });

      resolve(domElement);
    });
  }
}

export default WorkspacePage.compose({
  template: workspacePageTemplate,
  styles: workspacePageStyles
}).define();
