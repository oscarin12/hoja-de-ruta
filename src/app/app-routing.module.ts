// app-routing.module.ts
import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

export const routes: Routes = [
  // ⬇️ Home: redirige a hoja-ruta
  { path: '', pathMatch: 'full', redirectTo: 'hoja-ruta' },

  // Página Hoja de Ruta (standalone)
  {
    path: 'hoja-ruta',
    loadComponent: () =>
      import('./pages/hoja-ruta/hoja-ruta.page').then(m => m.HojaRutaPage)
  },

  // Otras rutas 
  {
    path: 'folder/:id',
    loadChildren: () => import('./folder/folder.module').then(m => m.FolderPageModule)
  },

  // Fallback: cualquier ruta desconocida vuelve a hoja-ruta
  { path: '**', redirectTo: 'hoja-ruta' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })],
  exports: [RouterModule]
})
export class AppRoutingModule {}
