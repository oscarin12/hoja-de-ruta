
import { AfterViewInit, Component, ElementRef, ViewChild, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { IonicModule, IonDatetime, ToastController } from '@ionic/angular';
import * as L from 'leaflet';
import { Geolocation, PermissionStatus } from '@capacitor/geolocation';

@Component({
  selector: 'app-hoja-ruta',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule],
  templateUrl: './hoja-ruta.page.html',
  styleUrls: ['./hoja-ruta.page.scss'],
})
export class HojaRutaPage implements AfterViewInit {

  // Refs de plantilla
  @ViewChild('mapEl') mapEl!: ElementRef<HTMLDivElement>;
  @ViewChild('dateEl') dateEl!: IonDatetime;
  @ViewChild('reportEl') reportEl!: ElementRef<HTMLElement>;

  // Estado del formulario
  routeType: '17-normal' | '17a' = '17-normal';
  dayISO: string = this.todayISODate();

  // Tiempos
  startTimestamp: Date | null = null;
  endTimestamp: Date | null = null;
  durationMinutes = 0;

  // UI
  isRunning = false;
  showReport = false;

  // Leaflet
  private map!: L.Map;
  private startMarker?: L.Marker;
  private accuracyCircle?: L.Circle;

  // Geoloc rápida/precisa
  private refineWatchId?: string;
  private lastLatLng?: { lat: number; lng: number };

  // Direcciones/coords de inicio/fin
  startPlace: string = '-';
  endPlace: string = '-';
  startCoords?: { lat: number; lng: number };
  endCoords?: { lat: number; lng: number };

  // Tracking en vivo
  private trackWatchId?: string;
  private trackCoords: L.LatLngTuple[] = [];
  private trackPolyline?: L.Polyline;
  totalDistanceMeters = 0;

  // Contenedor de capas de ruta
  private routeLayer?: L.LayerGroup;

  // Suavizado (EMA)
  private smoothLat?: number;
  private smoothLng?: number;

  // Ajustes finos de tracking (más denso y preciso)
  private minPointDistance = 1;     // metros mínimos entre puntos "reales"
  private maxAllowedAccuracy = 5;   // precisión máxima aceptada (m)
  private densifyStepM = 1;         // interpola cada 1 m entre puntos
  private smoothAlpha = 0.45;       // 0..1 (más alto = más rápido responde, menos filtro)
  private lastFixTs?: number;       // último timestamp usado (ms)

  // Auto-follow del mapa
  private isAutoFollow = true;      // seguir al usuario mientras no arrastre/zoomee
  private minCenterDistance = 15;   // si se mueve >15 m, recenter
  private innerPadding = 0.25;      // 25% de padding en la "caja interior" antes de recentrar

  // Contexto
  private isNative = Capacitor.isNativePlatform();
  private isSecure = typeof window !== 'undefined' && (window.isSecureContext || location.protocol === 'https:');

  constructor(private toastCtrl: ToastController, private ngZone: NgZone) {
    // Fix iconos Leaflet desde /assets
    // @ts-ignore
    delete (L.Icon.Default as any).prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'assets/leaflet/marker-icon-2x.png',
      iconUrl: 'assets/leaflet/marker-icon.png',
      shadowUrl: 'assets/leaflet/marker-shadow.png',
    });
  }

  async ngAfterViewInit() { }

  ionViewDidEnter() {
    this.ngZone.runOutsideAngular(() => {
      this.map = L.map(this.mapEl.nativeElement, {
        center: [0, 0],
        zoom: 2,
        preferCanvas: true,
        zoomAnimation: true,
        fadeAnimation: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        subdomains: ['a', 'b', 'c'],
        detectRetina: true,
        keepBuffer: 2,
        crossOrigin: true,
        updateWhenIdle: true,
        updateWhenZooming: false,
      }).addTo(this.map);

      setTimeout(() => this.map.invalidateSize(), 60);


      this.routeLayer = L.layerGroup().addTo(this.map);


      this.centerFastThenAccurate()
        .then(() => this.startRefineWatch(30, 20000))
        .catch(() => this.startRefineWatch(30, 20000));


      this.map.on('dragstart zoomstart', () => { this.isAutoFollow = false; });
    });
  }

  ionViewWillLeave() { this.stopRefineWatch(); }

  // Toast
  private async showToast(msg: string, color: 'primary' | 'success' | 'warning' | 'danger' = 'primary') {
    const t = await this.toastCtrl.create({ message: msg, duration: 1800, color });
    t.present();
  }

  // Permisos
  private async ensurePermissions(): Promise<boolean> {
    if (!this.isNative && !this.isSecure) {
      const t = await this.toastCtrl.create({
        message: 'Para usar la ubicación en navegador, abre en HTTPS o instala la app.',
        duration: 2500, color: 'warning'
      });
      t.present();
      return false;
    }
    try {
      const status: PermissionStatus = await Geolocation.checkPermissions();
      if (status.location === 'granted' || status.coarseLocation === 'granted') return true;
      const req = await Geolocation.requestPermissions();
      return req.location === 'granted' || req.coarseLocation === 'granted';
    } catch {
      return false;
    }
  }

  // Centro rápido -> preciso
  private async centerFastThenAccurate() {
    try {
      const fast = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 5000, maximumAge: 0 });
      this.applyPosition(fast.coords.latitude, fast.coords.longitude, 'Tu ubicación (rápida)');

      const precise = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
      this.applyPosition(precise.coords.latitude, precise.coords.longitude, 'Tu ubicación (precisa)', precise.coords.accuracy);
    } catch {
      this.applyPosition(-38.7397, -72.5984, 'Fallback: Temuco');
    }
  }

  private applyPosition(lat: number, lng: number, text: string, accuracy?: number) {
    this.lastLatLng = { lat, lng };
    if (this.map.getZoom() < 14) this.map.setView([lat, lng], 15);
    this.setOrMoveMarker(lat, lng, text);
    if (accuracy && accuracy > 0) this.updateAccuracyCircle(lat, lng, accuracy);
  }

  // Refinamiento temporal de precisión
  private startRefineWatch(targetAccuracy = 30, maxMs = 20000) {
    const startT = Date.now();
    this.stopRefineWatch();

    this.refineWatchId = Geolocation.watchPosition(
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
      (pos, err) => {
        if (err || !pos) return;
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        this.lastLatLng = { lat, lng };

        const accTxt = typeof accuracy === 'number' ? ` (±${Math.round(accuracy)} m)` : '';
        this.setOrMoveMarker(lat, lng, `Mi ubicación${accTxt}`);

        if (this.map.getZoom() < 15) this.map.setView([lat, lng], 15, { animate: true });
        if (accuracy && accuracy > 0) this.updateAccuracyCircle(lat, lng, accuracy);

        const good = typeof accuracy === 'number' && accuracy > 0 && accuracy <= targetAccuracy;
        const timedOut = Date.now() - startT > maxMs;
        if (good || timedOut) this.stopRefineWatch();
      }
    ) as unknown as string;
  }

  private stopRefineWatch() {
    if (this.refineWatchId) {
      Geolocation.clearWatch({ id: this.refineWatchId });
      this.refineWatchId = undefined;
    }
  }

  private updateAccuracyCircle(lat: number, lng: number, accuracy: number) {
    const target = this.routeLayer ?? this.map;
    if (!this.accuracyCircle) {
      this.accuracyCircle = L.circle([lat, lng], { radius: accuracy }).addTo(target);
    } else {
      this.accuracyCircle.setLatLng([lat, lng]).setRadius(accuracy);
    }
  }

  private setOrMoveMarker(lat: number, lng: number, text = 'Aquí') {
    const target = this.routeLayer ?? this.map;
    if (this.startMarker) {
      this.startMarker.setLatLng([lat, lng]).bindPopup(text);
    } else {
      this.startMarker = L.marker([lat, lng]).addTo(target).bindPopup(text).openPopup();
    }
  }

  // Reverse geocode
  private async reverseGeocode(lat: number, lng: number): Promise<string> {
    const nominatim = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1&accept-language=es`;
    const bdc = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lng)}&localityLanguage=es`;

    const fetchWithTimeout = (url: string, ms = 7000) =>
      Promise.race([fetch(url, { cache: 'no-store' }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]) as Promise<Response>;

    try {
      const r1 = await fetchWithTimeout(nominatim);
      if (r1.ok) {
        const j = await r1.json();
        const name: string = j?.display_name;
        if (name?.trim()) return name;
      }
    } catch { }

    try {
      const r2 = await fetchWithTimeout(bdc);
      if (r2.ok) {
        const j2 = await r2.json();
        const line = [j2?.locality, j2?.city, j2?.principalSubdivision, j2?.countryName]
          .filter((v, i, a) => !!v && a.indexOf(v) === i)
          .join(', ');
        if (line) return line;
      }
    } catch { }

    return `(${lat.toFixed(5)}, ${lng.toFixed(5)})`;
  }

  // Iniciar
  async start() {
    if (!this.dayISO) this.dayISO = this.todayISODate();
    const ok = await this.ensurePermissions();
    if (!ok) return;

    // reset watchers y estado de follow
    this.stopRefineWatch();
    this.stopTracking();
    this.isAutoFollow = true;

    // limpia todo lo anterior
    this.clearRoute();
    this.smoothLat = this.smoothLng = undefined;

    // estado
    this.startTimestamp = new Date();
    this.endTimestamp = null;
    this.durationMinutes = 0;
    this.isRunning = true;
    this.showReport = false;

    // tracking
    this.totalDistanceMeters = 0;
    this.startTracking();

    // dirección de inicio
    this.startPlace = 'Buscando dirección…';
    let lat = this.lastLatLng?.lat;
    let lng = this.lastLatLng?.lng;
    if (lat == null || lng == null) {
      try {
        const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
        lat = p.coords.latitude; lng = p.coords.longitude;
      } catch { }
    }
    if (lat != null && lng != null) {
      this.startCoords = { lat, lng };
      this.startPlace = await this.reverseGeocode(lat, lng);
      this.showToast('Inicio: ' + this.startPlace, 'success');
      this.imprimirIniciodeRuta('60mm');
    } else {
      this.startPlace = '-';
      this.showToast('No se pudo tomar la ubicación de inicio', 'warning');
    }

  }

  // Finalizar
  async end() {
    if (!this.startTimestamp) return;

    this.stopTracking();

    this.endTimestamp = new Date();
    const ms = this.endTimestamp.getTime() - this.startTimestamp.getTime();
    this.durationMinutes = Math.round(ms / 1000 / 60);
    this.isRunning = false;

    this.endPlace = 'Buscando dirección…';
    let lat = this.lastLatLng?.lat;
    let lng = this.lastLatLng?.lng;
    if (lat == null || lng == null) {
      try {
        const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
        lat = p.coords.latitude; lng = p.coords.longitude;
      } catch { }
    }
    if (lat != null && lng != null) {
      this.endCoords = { lat, lng };
      this.endPlace = await this.reverseGeocode(lat, lng);
      this.showToast('Término: ' + this.endPlace, 'success');
    } else {
      this.endPlace = '-';
      this.showToast('No se pudo tomar la ubicación de término', 'warning');
    }



    this.showReport = true;

    // opcional: map-matching OSRM para “apegar” a calle
    try {
      const matched = await this.mapMatchOsrm(this.trackCoords);
      if (matched && matched.length > 1) {
        if (this.trackPolyline) { this.map.removeLayer(this.trackPolyline); this.trackPolyline = undefined; }
        const target = this.routeLayer ?? this.map;
        L.polyline(matched, {
          color: '#1a73e8',
          weight: 5,
          lineJoin: 'round',
          lineCap: 'round'
        }).addTo(target);
      }
    } catch { }
  }

 // PDF (recibo compacto, sin espacio arriba)
async downloadReportPdf(mode: 'a4' | '58mm' | '60mm' = '60mm') {
  // Cargar jsPDF
  let jsPDFCtor: any;
  try {
    const jsPdfMod = await import('jspdf');
    jsPDFCtor = jsPdfMod.jsPDF || jsPdfMod.default || (jsPdfMod as any);
  } catch {
    this.showToast('Error cargando librería PDF', 'danger');
    return;
  }

  // ===== Formato =====
  const isA4 = mode === 'a4';
  const is58 = mode === '58mm';
  // Alto inicial cualquiera; lo recortamos al final
  const format: any = isA4 ? 'a4' : (is58 ? [58, 180] : [60, 110]);
  const pdf = new jsPDFCtor({ orientation: 'p', unit: 'mm', format });

  // Márgenes MUY pequeños
  const MX = isA4 ? 12 : 3;   // margen X
  const MY = isA4 ? 1  : 2;   // margen Y  <<< más chico
  const W  = pdf.internal.pageSize.getWidth() - MX * 2;

  // Tipografías
  const FS_TITLE   = isA4 ? 16   : 11;
  const FS_LABEL   = isA4 ? 10.5 : 8.2;
  const FS_VALUE   = isA4 ? 11.5 : 9.2;
  const FS_SECTION = isA4 ? 12   : 9.2;
  const FS_FOOT    = isA4 ? 10.5 : 8;

  // Espaciados (compactos)
  const GAP_SECTION = isA4 ? 3.0 : 2.0;
  const GAP_ROW     = isA4 ? 2.0 : 1.2;
  const INDENT      = 4;

  let y = MY; // ¡arrancamos bien arriba!

  // Helpers
  const lineH = (txt: string | string[], size: number) => {
    pdf.setFontSize(size);
    const d = pdf.getTextDimensions(txt);
    return d.h || (size * 0.42);
  };
  const wrap = (text: string) =>
    pdf.splitTextToSize((text || '-').toString(), W - INDENT) as string[];

  const addRow = (label: string, value: string) => {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(FS_LABEL);
    pdf.text(label + ':', MX, y);
    y += lineH(label + ':', FS_LABEL);

    const lines = wrap(value && value.trim() ? value : '-');
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(FS_VALUE);
    for (const ln of lines) { pdf.text(ln, MX + INDENT, y); y += lineH(ln, FS_VALUE); }
    y += GAP_ROW;
  };

  // ===== Cabecera (sin gap extra) =====
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(FS_TITLE);
  const title = 'HOJA DE RUTA';
  const tW = pdf.getTextWidth(title);
  pdf.text(title, MX + (W - tW) / 2, y);
  y += lineH(title, FS_TITLE); // no sumamos extra

  // ===== Datos del Viaje =====
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(FS_SECTION);
  pdf.text('Datos del Viaje', MX, y);
  y += lineH('Datos del Viaje', FS_SECTION) + GAP_SECTION;

  addRow('Conductor', 'Oscar Medina');
  addRow('Día', this.dayLabel);
  addRow('Tipo de Recorrido', this.routeLabel);
  addRow('Terminal', this.terminalLabel);

  // ===== Inicio =====
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(FS_SECTION);
  pdf.text('Inicio', MX, y);
  y += lineH('Inicio', FS_SECTION) + GAP_SECTION;

  addRow('Hora de Inicio', this.startTimeLabel);
  addRow('Lugar de Inicio', this.startPlace);
 

  // ===== Final =====
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(FS_SECTION);
  pdf.text('Final', MX, y);
  y += lineH('Final', FS_SECTION) + GAP_SECTION;

  addRow('Hora de Fin', this.endTimeLabel);
  addRow('Duración', `${this.durationMinutes} minutos`);
  addRow('Lugar de Término', this.endPlace);
 

  // ===== Pie =====
  const footer = `Generado: ${new Date().toLocaleString('es-CL')}`;
  pdf.setFont('helvetica', 'italic'); pdf.setFontSize(FS_FOOT);
  pdf.text(footer, MX, y);
  y += lineH(footer, FS_FOOT);

  // Recorte del alto pegado al contenido (2 mm de resguardo)
  if (!isA4) {
    const finalH = Math.max(Math.ceil(y + 2), 40);
    const last = pdf.getNumberOfPages();
    pdf.setPage(last);
    const ps: any = pdf.internal.pageSize;
    if (typeof ps.setHeight === 'function') ps.setHeight(finalH);
    else ps.height = finalH;
  }

  // Guardar / Compartir
  const fileName = `inicio-ruta-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.pdf`;
  if (!Capacitor.isNativePlatform()) {
    try { pdf.save(fileName); this.showToast('PDF descargado', 'success'); }
    catch { this.showToast('No se pudo descargar el PDF', 'danger'); }
    return;
  }
  try {
    const dataUri = pdf.output('datauristring');
    const base64 = dataUri.split(',')[1];
    const res = await Filesystem.writeFile({
      path: fileName, data: base64, directory: Directory.Cache, recursive: true
    });
    try {
      await Share.share({
        title: 'Hoja de Ruta - Inicio',
        text: 'Ticket de inicio y fin de ruta',
        url: res.uri,
        dialogTitle: 'Compartir PDF'
      });
      this.showToast('PDF listo para compartir', 'success');
    } catch {
      this.showToast(`PDF guardado en: ${res.uri}`, 'warning');
    }
  } catch {
    this.showToast('No se pudo guardar el PDF', 'danger');
  }
}


  //  Getters para plantilla 
  get startTimeLabel(): string {
    return this.startTimestamp
      ? this.startTimestamp.toLocaleTimeString('es-CL', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      })
      : '-';
  }
  get endTimeLabel(): string {
    return this.endTimestamp
      ? this.endTimestamp.toLocaleTimeString('es-CL', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      })
      : '-';
  }
  get routeLabel(): string {
    return this.routeType === '17-normal' ? '17: V.CAUPOLICAN ' : '17A:El CARMEN';
  }
  get terminalLabel(): string {
    return this.routeType === '17-normal'
      ? 'Terminal Tripiales - Pueblo Nuevo'
      : 'Terminal Trapiales - Pueblo Nuevo';
  }
  get dayLabel(): string {
    if (!this.dayISO) return '-';
    const [y, m, d] = this.dayISO.split('-').map(Number);
    const localDate = new Date(y, (m ?? 1) - 1, d ?? 1);
    return localDate.toLocaleDateString('es-CL', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  //  Tracking en vivo 
  private startTracking() {
    if (this.trackWatchId) return;

    this.clearTrack();
    this.lastFixTs = undefined;

    const target = this.routeLayer ?? this.map;
    this.trackPolyline = L.polyline([], {
      color: '#0077ff',
      weight: 4,
      lineJoin: 'round',
      lineCap: 'round'
    }).addTo(target);

    const MIN_TIME_MS = 1000; // mínimo 1s entre puntos

    this.trackWatchId = Geolocation.watchPosition(
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0 // no reutilizar viejas
      },
      (pos, err) => {
        if (err || !pos) return;

        const now = Date.now();
        if (!this.lastFixTs || (now - this.lastFixTs) >= MIN_TIME_MS) {
          this.lastFixTs = now;
        }

        const { latitude, longitude, accuracy = 9999 } = pos.coords;
        if (accuracy > this.maxAllowedAccuracy) return;

        // suavizado
        const [sLat, sLng] = this.smoothPoint(latitude, longitude);
        const pt: L.LatLngTuple = [sLat, sLng];

        const last = this.trackCoords[this.trackCoords.length - 1];

        if (!last) {
          this.trackCoords.push(pt);
          this.trackPolyline!.addLatLng(pt);
          this.setOrMoveMarker(pt[0], pt[1], `Mi ubicación (±${Math.round(accuracy)} m)`);
          this.maybeCenterOn(pt[0], pt[1]);
          return;
        }

        // distancia desde el último punto
        const d = this.map.distance(L.latLng(last[0], last[1]), L.latLng(pt[0], pt[1]));
        if (d < this.minPointDistance) {
          if (this.lastFixTs && (now - this.lastFixTs) < MIN_TIME_MS) return;
        }

        // densificar segmento
        const densified = this.densifySegment(last, pt, this.densifyStepM);

        let prev = last;
        for (const p of densified) {
          const seg = this.map.distance(L.latLng(prev[0], prev[1]), L.latLng(p[0], p[1]));
          this.totalDistanceMeters += seg;
          this.trackCoords.push(p);
          this.trackPolyline!.addLatLng(p);
          prev = p;
        }

        // marcador y seguimiento
        this.setOrMoveMarker(pt[0], pt[1], `Mi ubicación (±${Math.round(accuracy)} m)`);
        this.maybeCenterOn(pt[0], pt[1]);
      }
    ) as unknown as string;
  }

  private stopTracking() {
    if (this.trackWatchId) {
      Geolocation.clearWatch({ id: this.trackWatchId });
      this.trackWatchId = undefined;
    }
  }

  clearTrack() {
    this.stopTracking();
    this.totalDistanceMeters = 0;
    this.trackCoords = [];
    this.smoothLat = this.smoothLng = undefined;
    if (this.trackPolyline) {
      this.map.removeLayer(this.trackPolyline);
      this.trackPolyline = undefined;
    }
  }

  get distanceLabel(): string {
    return this.totalDistanceMeters < 1000
      ? `${Math.round(this.totalDistanceMeters)} m`
      : `${(this.totalDistanceMeters / 1000).toFixed(2)} km`;
  }

  private clearRoute() {
    // por si quedó algo activo
    this.stopTracking();
    this.stopRefineWatch();

    // limpia capas
    if (this.startMarker) { this.startMarker.remove(); this.startMarker = undefined; }
    if (this.accuracyCircle) { this.accuracyCircle.remove(); this.accuracyCircle = undefined; }
    if (this.trackPolyline) { this.map.removeLayer(this.trackPolyline); this.trackPolyline = undefined; }
    this.routeLayer?.clearLayers();

    // reset datos informe
    this.startCoords = undefined;
    this.endCoords = undefined;
    this.startPlace = '-';
    this.endPlace = '-';
    this.startTimestamp = null;
    this.endTimestamp = null;
    this.durationMinutes = 0;
    this.showReport = false;

    // reset tracking
    this.totalDistanceMeters = 0;
    this.trackCoords = [];
    this.smoothLat = this.smoothLng = undefined;
  }

  //  Suavizado (EMA) 
  private smoothPoint(lat: number, lng: number): L.LatLngTuple {
    if (this.smoothLat == null || this.smoothLng == null) {
      this.smoothLat = lat; this.smoothLng = lng;
    } else {
      this.smoothLat = this.smoothLat + this.smoothAlpha * (lat - this.smoothLat);
      this.smoothLng = this.smoothLng + this.smoothAlpha * (lng - this.smoothLng);
    }
    return [this.smoothLat, this.smoothLng];
  }

  //  Map matching OSRM (opcional) 
  private toOsrmCoords(points: L.LatLngTuple[]): string {
    return points.map(([la, ln]) => `${ln},${la}`).join(';'); // OSRM usa lon,lat
  }

  private async mapMatchOsrm(points: L.LatLngTuple[]): Promise<L.LatLngTuple[] | null> {
    if (!points || points.length < 2) return null;
    const coords = this.toOsrmCoords(points);
    const url = `https://router.project-osrm.org/match/v1/driving/${coords}?overview=full&geometries=geojson`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const data = await resp.json();
      const route = data?.matchings?.[0]?.geometry;
      if (!route || route.type !== 'LineString') return null;

      return route.coordinates.map(([lon, lat]: [number, number]) => [lat, lon]);
    } catch {
      return null;
    }
  }

  //  Utilidades 
  private todayISODate(): string {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  }

  // Interpola puntos cada 'stepM' entre A y B
  private densifySegment(a: L.LatLngTuple, b: L.LatLngTuple, stepM: number): L.LatLngTuple[] {
    const from = L.latLng(a[0], a[1]);
    const to = L.latLng(b[0], b[1]);
    const dist = from.distanceTo(to);
    if (dist <= stepM) return [b];

    const n = Math.floor(dist / stepM);
    const res: L.LatLngTuple[] = [];
    for (let i = 1; i <= n; i++) {
      const t = (i * stepM) / dist;
      const lat = from.lat + (to.lat - from.lat) * t;
      const lng = from.lng + (to.lng - from.lng) * t;
      res.push([lat, lng]);
    }
    res.push([to.lat, to.lng]);
    return res;
  }

  // Auto-follow inteligente
  private maybeCenterOn(lat: number, lng: number) {
    if (!this.isAutoFollow) return;

    const here = L.latLng(lat, lng);
    const bounds = this.map.getBounds();
    const inner = bounds.pad(-this.innerPadding); // caja interior
    const center = this.map.getCenter();
    const movedM = here.distanceTo(center);

    if (!inner.contains(here) || movedM > this.minCenterDistance) {
      this.map.setView(here, Math.max(this.map.getZoom(), 15), { animate: true });
    }
  }

  // Botón para reactivar el seguimiento automático
  enableAutoFollow() {
    this.isAutoFollow = true;
    if (this.lastLatLng) this.maybeCenterOn(this.lastLatLng.lat, this.lastLatLng.lng);
  }

  async imprimirIniciodeRuta(mode: 'a4' | '58mm' | '60mm' = '60mm') {
    // Cargar jsPDF
    let jsPDFCtor: any;
    try {
      const jsPdfMod = await import('jspdf');
      jsPDFCtor = jsPdfMod.jsPDF || jsPdfMod.default || (jsPdfMod as any);
    } catch {
      this.showToast('Error cargando librería PDF', 'danger');
      return;
    }

    // ===== Formato robusto (recibo) =====
    const isA4 = mode === 'a4';
    const is58 = mode === '58mm';
    const format: any = isA4 ? 'a4' : (is58 ? [58, 180] : [60, 100]); // alto se recorta al final
    const pdf = new jsPDFCtor({ orientation: 'p', unit: 'mm', format });

    // Margen/medidas
    const MX = isA4 ? 14 : 5;       // margen X
    const MY = isA4 ? 12 : 6;       // margen Y
    const W = pdf.internal.pageSize.getWidth() - MX * 2;

    // Tipografías
    const FS_TITLE = isA4 ? 16 : 11;
    const FS_LABEL = isA4 ? 10.5 : 8.2;
    const FS_VALUE = isA4 ? 11.5 : 9.2;
    const FS_SECTION = isA4 ? 12 : 9.2;
    const FS_FOOT = isA4 ? 11 : 8;

    // Espaciados
    const GAP_SECTION = isA4 ? 4 : 3;
    const GAP_BLOCK = isA4 ? 3.5 : 2.2;  // entre etiqueta y valor
    const GAP_ROW = isA4 ? 2.5 : 1.6;  // entre filas
    const INDENT = 4;                 // sangría del valor

    let y = MY;

    // Helpers
    const lineH = (txt: string | string[], size: number) => {
      pdf.setFontSize(size);
      const d = pdf.getTextDimensions(txt);
      return d.h || (size * 0.42); // fallback defensivo
    };

    const wrap = (text: string) => pdf.splitTextToSize((text || '-').toString(), W - INDENT) as string[];

    const addRow = (label: string, value: string) => {
      // Etiqueta
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(FS_LABEL);
      pdf.text(label + ':', MX, y);
      y += lineH(label + ':', FS_LABEL);

      // Valor (multilínea con sangría)
      const lines = wrap(value && value.trim() ? value : '-');
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(FS_VALUE);
      for (const ln of lines) {
        pdf.text(ln, MX + INDENT, y);
        y += lineH(ln, FS_VALUE);
      }
      y += GAP_ROW;
    };

    // ===== Cabecera =====
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(FS_TITLE);
    const title = 'HOJA DE RUTA · INICIO';
    const tW = pdf.getTextWidth(title);
    pdf.text(title, MX + (W - tW) / 2, y);
    y += lineH(title, FS_TITLE) + 2;


    // ===== Sección Datos del Viaje =====
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(FS_SECTION);
    pdf.text('Datos del Viaje', MX, y);
    y += lineH('Datos del Viaje', FS_SECTION) + GAP_SECTION;

    addRow('Conductor', 'Oscar Medina');
    addRow('Día', this.dayLabel);
    addRow('Tipo de Recorrido', this.routeLabel);
    addRow('Terminal', this.terminalLabel);



    // ===== Sección Inicio =====
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(FS_SECTION);
    pdf.text('Inicio', MX, y);
    y += lineH('Inicio', FS_SECTION) + GAP_SECTION;

    addRow('Hora de Inicio', this.startTimeLabel);
    addRow('Lugar de Inicio', this.startPlace);
    if (this.startCoords) {
      addRow('Coordenadas', `${this.startCoords.lat.toFixed(5)}, ${this.startCoords.lng.toFixed(5)}`);
    }

    // ===== Pie =====

    const footer = `Generado: ${new Date().toLocaleString('es-CL')}`;
    pdf.setFont('helvetica', 'italic'); pdf.setFontSize(FS_FOOT);
    pdf.text(footer, MX, y);
    y += lineH(footer, FS_FOOT);

    // Recorte del alto (muy importante para que no “desaparezca” contenido)
    if (!isA4) {
      const finalH = Math.max(Math.ceil(y + MY), 50);
      const last = pdf.getNumberOfPages();
      pdf.setPage(last);
      const ps: any = pdf.internal.pageSize;
      if (typeof ps.setHeight === 'function') ps.setHeight(finalH);
      else ps.height = finalH;
    }

    // Guardar / Compartir
    const fileName = `inicio-ruta-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.pdf`;
    if (!Capacitor.isNativePlatform()) {
      try { pdf.save(fileName); this.showToast('PDF descargado', 'success'); }
      catch { this.showToast('No se pudo descargar el PDF', 'danger'); }
      return;
    }
    try {
      const dataUri = pdf.output('datauristring');
      const base64 = dataUri.split(',')[1];
      const res = await Filesystem.writeFile({
        path: fileName, data: base64, directory: Directory.Cache, recursive: true
      });
      try {
        await Share.share({
          title: 'Hoja de Ruta - Inicio',
          text: 'Ticket de inicio de ruta',
          url: res.uri,
          dialogTitle: 'Compartir PDF'
        });
        this.showToast('PDF listo para compartir', 'success');
      } catch {
        this.showToast(`PDF guardado en: ${res.uri}`, 'warning');
      }
    } catch {
      this.showToast('No se pudo guardar el PDF', 'danger');
    }
  }




}
