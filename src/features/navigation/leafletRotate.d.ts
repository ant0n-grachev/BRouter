import 'leaflet';

declare module 'leaflet' {
  interface LeafletEventHandlerFnMap {
    rotate?: LeafletEventHandlerFn;
  }
}
