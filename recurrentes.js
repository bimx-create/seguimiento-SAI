// ============================================================
// Lógica para Seguimiento de Pacientes Recurrentes (Esferas + Firebase)
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
let seguimientosCache = new Map(); // Cache local en memoria para UI veloz

// --- 2) UTILIDADES ---
let toastTimer = null;
function showToast(message, type = "success") {
  const toast = $("toast");
  toast.textContent = message;
  toast.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.className = "toast hidden";
  }, 2600);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizarTexto(valor) {
  return String(valor ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Variables Globales
const SEDES_REQUERIDAS = ["Narvarte", "Toluca", "Morelia", "Tijuana", "Santa Fe"];
let globalSedesMap = new Map();
let sedeActual = "";
const fechaHoy = new Date();

// --- 3) CARGA DE DATOS (SUPABASE + FIREBASE) ---
async function cargarDatos() {
  try {
    // Cargar seguimientos desde Firebase
    const snapshot = await db.collection("seguimientos").get();
    snapshot.forEach(doc => {
      seguimientosCache.set(doc.id, doc.data().comentarios || "");
    });
    
    // Cargar pacientes desde Supabase
    const { data, error } = await supabaseClient
      .from("cotizaciones")
      .select("*");

    if (error) throw error;
    
    procesarDatos(data || []);
  } catch (err) {
    console.error(err);
    showToast("Error al cargar datos.", "error");
    $("loadingIndicator").textContent = "Error al cargar datos.";
  }
}

function procesarDatos(rows) {
  const pacientesMap = new Map();

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

  globalSedesMap.clear();
  SEDES_REQUERIDAS.forEach(s => globalSedesMap.set(s, []));

  recurrentes.forEach(p => {
    p.registros.sort((a, b) => (b.fecha_infusion || "").localeCompare(a.fecha_infusion || ""));
    
    p.ultimaVisitaDateString = p.registros[0].fecha_infusion || "";
    if (p.ultimaVisitaDateString) {
      const fechaUltima = new Date(p.ultimaVisitaDateString + "T12:00:00"); 
      p.diasSinVenir = Math.floor((fechaHoy - fechaUltima) / (1000 * 60 * 60 * 24));
    } else {
      p.diasSinVenir = 0;
    }
    
    p.sedes.forEach(sede => {
      let matchedSede = SEDES_REQUERIDAS.find(sr => sr.toLowerCase() === sede.toLowerCase());
      if (matchedSede) {
        globalSedesMap.get(matchedSede).push(p);
      }
    });
  });

  renderEsferas();
}

// --- 4) NAVEGACIÓN Y RENDER UI ---
function renderEsferas() {
  $("loadingIndicator").classList.add("hidden");
  $("vistaDetalle").classList.add("hidden");
  $("vistaEsferas").classList.remove("hidden");
  
  const container = $("esferasGrid");
  container.innerHTML = "";

  SEDES_REQUERIDAS.forEach(sede => {
    const pacientes = globalSedesMap.get(sede) || [];
    const count = pacientes.length;
    const cssClass = sede.replace(/\s+/g, '-');

    const btn = document.createElement("button");
    btn.className = `esfera ${cssClass}`;
    btn.onclick = () => abrirSede(sede);
    btn.innerHTML = `
      <span class="esfera-title">${escapeHtml(sede)}</span>
      <span class="esfera-count">${count} recurrentes</span>
    `;
    container.appendChild(btn);
  });
}

function abrirSede(sede) {
  sedeActual = sede;
  $("vistaEsferas").classList.add("hidden");
  $("vistaDetalle").classList.remove("hidden");
  $("detalleSedeTitulo").textContent = `${sede} (${globalSedesMap.get(sede).length} recurrentes)`;
  
  $("filtroTiempo").value = "todos";
  $("filtroNombre").value = "";
  
  renderListaPacientes();
}

function volverEsferas() {
  sedeActual = "";
  $("vistaDetalle").classList.add("hidden");
  $("vistaEsferas").classList.remove("hidden");
}

function getSeguimiento(pacienteNorm) {
  return seguimientosCache.get(pacienteNorm) || "";
}

async function saveSeguimiento(pacienteNorm, textareaId) {
  const texto = $(textareaId).value;
  // Actualizar cache local primero para UI rápida
  seguimientosCache.set(pacienteNorm, texto);
  
  try {
    await db.collection("seguimientos").doc(pacienteNorm).set({
      comentarios: texto,
      ultima_actualizacion: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    showToast("Seguimiento guardado en la nube.");
  } catch (err) {
    console.error("Error al guardar en Firebase:", err);
    showToast("Error al guardar en la nube.", "error");
  }
}

function renderListaPacientes() {
  const container = $("listaPacientesContainer");
  container.innerHTML = "";
  
  if (!sedeActual || !globalSedesMap.has(sedeActual)) return;
  
  let pacientes = globalSedesMap.get(sedeActual);
  
  const fTiempo = $("filtroTiempo").value;
  if (fTiempo !== "todos") {
    const minDias = parseInt(fTiempo, 10);
    pacientes = pacientes.filter(p => p.diasSinVenir >= minDias);
  }
  
  const fNombre = normalizarTexto($("filtroNombre").value);
  if (fNombre) {
    pacientes = pacientes.filter(p => 
      normalizarTexto(p.nombreOriginal).includes(fNombre) || 
      normalizarTexto(p.registros[0].diagnostico || "").includes(fNombre) ||
      normalizarTexto(p.registros[0].tratamiento || "").includes(fNombre)
    );
  }
  
  pacientes.sort((a, b) => b.diasSinVenir - a.diasSinVenir);
  
  if (pacientes.length === 0) {
    container.innerHTML = `<p class="muted" style="padding: 20px 0;">No se encontraron pacientes que coincidan con los filtros en esta sede.</p>`;
    return;
  }

  pacientes.forEach(p => {
    const normName = normalizarTexto(p.nombreOriginal);
    const card = document.createElement("div");
    card.className = "patient-card";
    
    const lastVisit = p.ultimaVisitaDateString || "Sin fecha";
    const totalVisits = p.registros.length;
    const tto = p.registros[0].tratamiento || p.registros[0].tipo_tratamiento || "No especificado";
    
    let diasBadgeHtml = "";
    if (p.diasSinVenir > 0) {
      const alertClass = p.diasSinVenir > 60 ? "badge-alerta" : "";
      diasBadgeHtml = `<span class="badge ${alertClass}" style="margin-left: 8px;" title="Días transcurridos desde su última visita">Hace ${p.diasSinVenir} días</span>`;
    }

    card.innerHTML = `
      <div class="patient-header">
        <div style="width: 100%;">
          <h3 class="patient-name">${escapeHtml(p.nombreOriginal)}</h3>
          <div class="patient-stats">
            Última visita: <strong>${escapeHtml(lastVisit)}</strong> ${diasBadgeHtml} <br/>
            Total visitas: <span class="badge">${totalVisits}</span> |
            Tratamiento reciente: <strong>${escapeHtml(tto)}</strong>
          </div>
        </div>
      </div>
      <div class="seguimiento-box">
        <label for="seg_${normName}">Comentarios / Seguimiento:</label>
        <textarea id="seg_${normName}" placeholder="Añade aquí los comentarios del caso y qué sucedió con este paciente...">${escapeHtml(getSeguimiento(normName))}</textarea>
        <button type="button" class="btn btn-primary" onclick="saveSeguimiento('${normName}', 'seg_${normName}')">Guardar Seguimiento</button>
      </div>
    `;
    container.appendChild(card);
  });
}

// --- 5) INICIO DEL SISTEMA ---
(function () {
  const THEME_KEY = "innvidaTema";
  function temaGuardado() {
    return localStorage.getItem(THEME_KEY) === "claro" ? "claro" : "oscuro";
  }
  function aplicarTema(tema) {
    document.documentElement.setAttribute("data-theme", tema === "claro" ? "light" : "dark");
  }
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
      });
    });

    cargarDatos();
  });
})();
