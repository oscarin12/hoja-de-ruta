import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HojaRutaPage } from './hoja-ruta.page';

describe('HojaRutaPage', () => {
  let component: HojaRutaPage;
  let fixture: ComponentFixture<HojaRutaPage>;

  beforeEach(() => {
    fixture = TestBed.createComponent(HojaRutaPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
