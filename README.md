Hoja de Ruta – Seguimiento de recorridos para colectivos

Aplicación móvil (Ionic + Angular + Capacitor) para registrar recorridos de inicio a fin de un vehículo de transporte (colectivo/taxi), con:

Hora de inicio y término

Duración total

Lugar de salida y llegada (con reverse geocoding)

Distancia recorrida

Mapa con el trazado de la ruta en vivo

Generación de PDF (formato A4 o térmico 58/60 mm)

Nota: el trazado se mejora continuamente. Es una app gratuita y en evolución.

✨ Características

📍 Seguimiento en tiempo real con GPS (suavizado y densificado de puntos para un trazo más estable).

🗺️ Mapa basado en Leaflet + OpenStreetMap.

🏷️ Registro del tipo de recorrido (p. ej., “17 Normal” / “17A”).

🕗 Fechas y horas locales (las horas en el informe muestran solo hora:min:seg).

🧾 Informe PDF con todos los datos clave (inicio, fin, duración, distancia, lugares).

🧹 Limpieza inteligente: al iniciar un nuevo recorrido, se borra el trazo anterior.

📱 Auto-follow del mapa (botón “Seguir” para recentrar tras mover el mapa a mano).

🖼️ Capturas

Agrega aquí tus imágenes

docs/screenshot-home.png

docs/screenshot-map.png

docs/screenshot-report.png

🛠️ Tecnologías

Angular + Ionic

Capacitor (Filesystem, Share, Geolocation)

Leaflet (mapa)

jsPDF (PDF)

OpenStreetMap / Nominatim (geocodificación inversa)

(Opcional) OSRM Map Matching para “pegar” la ruta a la calle

🚀 Instalación y ejecución
# 1) Instalar dependencias
npm install

# 2) Servir en navegador (requiere HTTPS para geolocalización)
ionic serve

# 3) Sincronizar plataformas móviles (ej. Android)
npx cap add android
npx cap sync
npx cap open android


En Android, compila y corre desde Android Studio.
Asegúrate de aceptar permisos de ubicación.

🔐 Permisos

La app solicita ubicación para:

Centrar el mapa en tu posición

Trazar la ruta en tiempo real

Registrar coordenadas de inicio/fin

📝 Uso

Abre la Hoja de Ruta.

Selecciona el tipo de recorrido.

Presiona Iniciar registro:

La app limpiará trazos previos y comenzará a seguir tu posición.

Guardará hora y lugar de inicio.

Presiona Finalizar registro:

Se calcula duración y distancia.

Se resuelve lugar de término.

Opcional: Descargar PDF (A4 o térmico 58/60 mm).

⚠️ Limitaciones y estado

El trazado se optimiza con suavizado/densificado; aún así depende de la precisión del GPS del dispositivo.

Navegador: requiere HTTPS para acceder al GPS.

Map matching (OSRM público) es opcional y puede fallar si el servicio está saturado.

🗺️ Configuración de mapa

Los íconos de Leaflet se sirven desde assets/leaflet/.
El mapa utiliza OpenStreetMap por defecto.

🧾 PDF

Generación con jsPDF.

Formatos: A4 y térmico 58/60 mm (alto ajustado al contenido).

Incluye conductor (placeholder), día, horas, duración, distancia, lugares.

📚 Roadmap

 Pausa/Reanudar seguimiento

 Exportar GPX/KML

 Historial de recorridos

 Mejoras de trazado y consumo energético

 Map matching offline / servidor propio

🤝 Contribuciones

¡Bienvenidas! Abre un issue o envía un pull request con mejoras o correcciones.
