import { app } from './app.js';
import { sincronizarPagosEmail, bandejaConfigurada } from './routes/pagosEmail.js';

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Servidor de Taxi Cobros escuchando en http://localhost:${PORT}`);
});

// Autorefresh de la bandeja de pagos por mail: cada tanto revisa el buzón
// y agrega SOLO los pagos nuevos (los ya cargados se saltean).
// MS_POLL_SEGUNDOS: cada cuánto revisar (por defecto 60; 0 = desactivado).
const cadaSeg = Number(process.env.MS_POLL_SEGUNDOS ?? 60);
if (cadaSeg > 0 && bandejaConfigurada()) {
  let corriendo = false;
  const revisar = async () => {
    if (corriendo) return;
    corriendo = true;
    try {
      const r = await sincronizarPagosEmail();
      if (r.nuevos > 0) console.log(`[bandeja] ${r.nuevos} pago(s) nuevo(s) por mail`);
    } catch (e) {
      console.error('[bandeja] no se pudo revisar el buzón:', e.message);
    } finally {
      corriendo = false;
    }
  };
  revisar();
  setInterval(revisar, cadaSeg * 1000);
  console.log(`Bandeja de pagos por mail: revisando el buzón cada ${cadaSeg}s.`);
}
