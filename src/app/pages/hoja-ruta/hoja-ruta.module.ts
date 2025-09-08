import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { HojaRutaPageRoutingModule } from './hoja-ruta-routing.module';

import { HojaRutaPage } from './hoja-ruta.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    HojaRutaPageRoutingModule
  ],
  declarations: [HojaRutaPage]
})
export class HojaRutaPageModule {}
