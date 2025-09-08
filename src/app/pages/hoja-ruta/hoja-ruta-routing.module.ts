import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { HojaRutaPage } from './hoja-ruta.page';

const routes: Routes = [
  {
    path: '',
    component: HojaRutaPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class HojaRutaPageRoutingModule {}
