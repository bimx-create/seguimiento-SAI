// ============================================================
// Lógica para Dashboard de Seguimiento (Supabase + Firebase + Chart.js)
// ============================================================

const $ = (id) => document.getElementById(id);

// --- 1) INICIALIZAR FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyAbbeQ_tylCsc9bl0ZJbL_7uOTyDt7naiY",
  authDomain: "seguimiento-a1841.firebaseapp.com",
  projectId: "seguimiento-a1841",
  storageBucket: "seguimiento-a1841.firebasestorage.app",
  messagingSenderId: "565369242763",
  appId: "1:565369242763:web:ea08ba4c2dd129ac24808e"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
let seguimientosCache = new Map(); 

// --- 2) UTILIDADES ---
function normalizarTexto(valor) {
  return String(valor ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const SEDES_REQUERIDAS = ["Narvarte", "Toluca", "Morelia", "Tijuana", "Santa Fe"];
const fechaHoy = new Date();

// Variables para los gráficos
let chartSedesInstancia = null;
let chartRetencionInstancia = null;
let todosLosRecurrentes = []; // Cache global de datos procesados

// --- 3) CARGA DE DATOS ---
async function cargarAnaliticas() {
  try {
    const snapshot = await db.collection("seguimientos").get();
    snapshot.forEach(doc => {
      if (doc.data().comentarios && doc.data().comentarios.trim() !== "") {
        seguimientosCache.set(doc.id, doc.data().comentarios);
      }
    });
    
    const { data, error } = await supabaseClient.from("cotizaciones").select("*");
    if (error) throw error;
    
    procesarAnaliticas(data || []);
  } catch (err) {
    console.error(err);
    $("loadingIndicator").textContent = "Error al generar analíticas.";
  }
}

function procesarAnaliticas(rows) {
  const pacientesMap = new Map();

  // Agrupar pacientes
  rows.forEach(r => {
    if (!r.paciente) return;
    const normName = normalizarTexto(r.paciente);
    
    if (!pacientesMap.has(normName)) {
      pacientesMap.set(normName, {
        nombreOriginal: r.paciente,
        registros: [],
        sedes: new Set(),
        esRecurrente: false
      });
    }
    
    const p = pacientesMap.get(normName);
    p.registros.push(r);
    
    let sedeRow = (r.sede || "Sin Sede").trim();
    if (sedeRow.toLowerCase().replace(/\s/g, "") === "santafe") sedeRow = "Santa Fe";
    p.sedes.add(sedeRow);
    
    if (String(r.primera_vez || "").toUpperCase().includes("SUBSECUENTE")) {
      p.esRecurrente = true;
    }
  });

  const recurrentes = Array.from(pacientesMap.values()).filter(p => p.registros.length > 1 || p.esRecurrente);
  
  // Pre-calcular datos fijos por paciente
  recurrentes.forEach(p => {
    const normName = normalizarTexto(p.nombreOriginal);
    p.normName = normName;
    p.registros.sort((a, b) => (b.fecha_infusion || "").localeCompare(a.fecha_infusion || ""));
    
    p.ultimaVisitaDateString = p.registros[0].fecha_infusion || "";
    if (p.ultimaVisitaDateString) {
      const fechaUltima = new Date(p.ultimaVisitaDateString + "T12:00:00"); 
      p.diasSinVenir = Math.floor((fechaHoy - fechaUltima) / (1000 * 60 * 60 * 24));
    } else {
      p.diasSinVenir = 0;
    }

    // Sede principal (la de su última visita)
    let sedePrincipal = "Desconocida";
    for (let sede of p.sedes) {
      let matchedSede = SEDES_REQUERIDAS.find(sr => sr.toLowerCase() === sede.toLowerCase());
      if (matchedSede) {
        sedePrincipal = matchedSede;
        break; 
      }
    }
    p.sedePrincipal = sedePrincipal;
  });

  todosLosRecurrentes = recurrentes;
  aplicarFiltroDash(); // Renderiza usando el filtro inicial ("Todas")
}

window.aplicarFiltroDash = function() {
  const filtroSede = $("filtroSedeDash").value;
  let pacientesFiltrados = todosLosRecurrentes;

  if (filtroSede !== "Todas") {
    pacientesFiltrados = todosLosRecurrentes.filter(p => p.sedePrincipal === filtroSede);
  }

  // Procesar métricas con los pacientes filtrados
  let totalRecurrentes = pacientesFiltrados.length;
  let conSeguimiento = 0;
  let enAlerta = 0;
  
  const conteoSedes = { "Narvarte":0, "Toluca":0, "Morelia":0, "Tijuana":0, "Santa Fe":0 };
  const conteoRetencion = { "Menos de 30 días":0, "30 a 60 días":0, "60 a 90 días":0, "Más de 90 días":0 };
  
  const listaParaTabla = [];

  pacientesFiltrados.forEach(p => {
    if (p.diasSinVenir > 60) enAlerta++;
    
    // Clasificar retención
    if (p.diasSinVenir < 30) conteoRetencion["Menos de 30 días"]++;
    else if (p.diasSinVenir <= 60) conteoRetencion["30 a 60 días"]++;
    else if (p.diasSinVenir <= 90) conteoRetencion["60 a 90 días"]++;
    else conteoRetencion["Más de 90 días"]++;

    if (conteoSedes[p.sedePrincipal] !== undefined) {
      conteoSedes[p.sedePrincipal]++;
    }

    // Comentarios
    const comentarioFirebase = seguimientosCache.get(p.normName);
    if (comentarioFirebase) {
      conSeguimiento++;
      listaParaTabla.push({
        paciente: p.nombreOriginal,
        sede: p.sedePrincipal,
        dias: p.diasSinVenir,
        comentario: comentarioFirebase
      });
    }
  });

  // KPI Sede Líder
  let sedeLider = "---";
  if (filtroSede === "Todas") {
    let maxSede = -1;
    Object.keys(conteoSedes).forEach(s => {
      if (conteoSedes[s] > maxSede && conteoSedes[s] > 0) {
        maxSede = conteoSedes[s];
        sedeLider = s;
      }
    });
  } else {
    // Si hay un filtro, la sede líder es esa misma sede, o "Ninguna" si no tiene pacientes.
    sedeLider = totalRecurrentes > 0 ? filtroSede : "---";
  }

  // Render KPIs
  $("kpiTotal").textContent = totalRecurrentes;
  $("kpiConSeguimiento").textContent = conSeguimiento;
  $("kpiAlerta").textContent = enAlerta;
  $("kpiSedeLider").textContent = sedeLider;

  // Render Tabla
  listaParaTabla.sort((a,b) => b.dias - a.dias);
  const tbody = $("tablaSeguimientosBody");
  tbody.innerHTML = listaParaTabla.map(row => `
    <tr>
      <td><strong>${escapeHtml(row.paciente)}</strong></td>
      <td>${escapeHtml(row.sede)}</td>
      <td>${row.dias > 60 ? `<span style="color:#f43f5e;font-weight:bold;">${row.dias} días</span>` : `${row.dias} días`}</td>
      <td><em style="color:var(--muted)">"${escapeHtml(row.comentario)}"</em></td>
    </tr>
  `).join("") || `<tr><td colspan="4" style="text-align:center; padding: 20px;">No hay comentarios guardados para este filtro.</td></tr>`;

  $("loadingIndicator").classList.add("hidden");
  $("dashboardContent").classList.remove("hidden");

  renderGraficos(conteoSedes, conteoRetencion, filtroSede);
}

function renderGraficos(conteoSedes, conteoRetencion, filtroSede) {
  Chart.defaults.color = document.documentElement.getAttribute("data-theme") === "dark" ? "#94a3b8" : "#64748b";
  Chart.defaults.font.family = "Inter, sans-serif";

  // Gráfico 1: Recurrentes por Sede
  // Si filtramos por sede, solo mostramos esa sede en el gráfico de barras.
  let labelsSedes = Object.keys(conteoSedes);
  let dataSedes = Object.values(conteoSedes);
  
  if (filtroSede !== "Todas") {
    labelsSedes = [filtroSede];
    dataSedes = [conteoSedes[filtroSede]];
  }

  const ctxSedes = $("chartSedes").getContext("2d");
  if (chartSedesInstancia) chartSedesInstancia.destroy();
  
  chartSedesInstancia = new Chart(ctxSedes, {
    type: 'bar',
    data: {
      labels: labelsSedes,
      datasets: [{
        label: 'Pacientes Recurrentes',
        data: dataSedes,
        backgroundColor: ['#4ea3ff', '#c084fc', '#34d399', '#fbbf24', '#f43f5e'],
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: 'Pacientes por Sede (Última Visita)', font: {size: 16} },
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true
        }
      }
    }
  });

  // Gráfico 2: Retención (Días sin venir)
  const ctxRetencion = $("chartRetencion").getContext("2d");
  if (chartRetencionInstancia) chartRetencionInstancia.destroy();

  chartRetencionInstancia = new Chart(ctxRetencion, {
    type: 'doughnut',
    data: {
      labels: Object.keys(conteoRetencion),
      datasets: [{
        data: Object.values(conteoRetencion),
        backgroundColor: ['#34d399', '#fbbf24', '#f97316', '#f43f5e'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: 'Distribución: Tiempo sin venir', font: {size: 16} }
      }
    }
  });
}

// Inicialización
(function () {
  const THEME_KEY = "innvidaTema";
  function temaGuardado() { return localStorage.getItem(THEME_KEY) === "claro" ? "claro" : "oscuro"; }
  function aplicarTema(tema) { document.documentElement.setAttribute("data-theme", tema === "claro" ? "light" : "dark"); }
  function actualizarBotones(tema) {
    document.querySelectorAll("[data-theme-toggle]").forEach(btn => {
      btn.textContent = tema === "claro" ? "🌙 Oscuro" : "☀️ Claro";
    });
  }
  
  aplicarTema(temaGuardado());
  document.addEventListener("DOMContentLoaded", () => {
    actualizarBotones(temaGuardado());
    document.querySelectorAll("[data-theme-toggle]").forEach(btn => {
      btn.addEventListener("click", () => {
        const nuevoTema = temaGuardado() === "claro" ? "oscuro" : "claro";
        localStorage.setItem(THEME_KEY, nuevoTema);
        aplicarTema(nuevoTema);
        actualizarBotones(nuevoTema);
        // Refresh charts color slightly if needed
        if (chartSedesInstancia) chartSedesInstancia.update();
        if (chartRetencionInstancia) chartRetencionInstancia.update();
      });
    });
    cargarAnaliticas();
  });
})();
