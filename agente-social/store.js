// Almacenamiento simple en archivo JSON (sin base de datos para el MVP).
// Para produccion se puede cambiar por PostgreSQL / SQLite sin tocar el resto.
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

const ESTADO_INICIAL = {
  empresas: [],
  publicaciones: [],
  mensajes: [],
};

function cargar() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    // Garantiza que existan todas las colecciones
    return { ...ESTADO_INICIAL, ...data };
  } catch (e) {
    return JSON.parse(JSON.stringify(ESTADO_INICIAL));
  }
}

let estado = cargar();

function guardar() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(estado, null, 2), 'utf8');
}

function id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

module.exports = { estado, guardar, id, cargar: () => (estado = cargar()) };
