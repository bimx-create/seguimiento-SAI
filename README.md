# Panel de Seguimiento — Pacientes Recurrentes

Herramienta web para el seguimiento de pacientes recurrentes por sede, con analíticas en tiempo real.

## Archivos incluidos

| Archivo | Descripción |
|---------|-------------|
| `recurrentes.html` | 🏠 **Punto de entrada** — Vista de esferas por sede |
| `recurrentes.js` | Lógica de esferas, filtros y guardado en Firebase |
| `seguimiento-dashboard.html` | 📊 Dashboard de analíticas (KPIs + gráficas) |
| `seguimiento-dashboard.js` | Lógica del dashboard (Chart.js + Firebase + Supabase) |
| `Supabaseclient.js` | Conexión a Supabase |
| `styles.css` | Estilos visuales |

## Cómo usar

Abrir `recurrentes.html` en el navegador — desde ahí se accede a todo.

## Servicios conectados

- **Supabase** → Lee los registros de pacientes del concentrado SAI
- **Firebase / Firestore** → Guarda los comentarios de seguimiento en la nube
- **Chart.js** (CDN) → Gráficas del dashboard

> ⚠️ Mantener este repositorio **privado** — contiene credenciales de Supabase y Firebase.
