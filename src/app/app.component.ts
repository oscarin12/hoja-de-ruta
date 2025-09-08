import { Component } from '@angular/core';
import { StatusBar, Style } from '@capacitor/status-bar';
@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent {


  async ngOnInit() {
    try {
      await StatusBar.setOverlaysWebView({ overlay: false }); // empuja la webview hacia abajo
      await StatusBar.setStyle({ style: Style.Dark });        // opcional
    } catch {}
  }
  public appPages = [
   
    { title: 'Hoja de Ruta', url: '/hoja-ruta', icon: 'map' },
  ];
  public labels = ['proximos'];

   public nombre = ['Oscar Medina'];
  constructor() {}
}
