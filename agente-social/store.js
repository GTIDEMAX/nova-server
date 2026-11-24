// Almacenamiento de datos.
//
// Soporta 2 modos:
//  1) MongoDB (recomendado en produccion): datos PERMANENTES aunque la app se
//     reinicie o se actualice. Se activa con la variable MONGODB_URI.
//  2) Archivo local data.json: simple, para desarrollo. En hostings gratis los
//     datos se borran al reiniciar (por eso en produccion usa MongoDB).
const fs = require('fs');
const path = require('path');

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const MONGODB_URI = process.env.MONGODB_URI;

const ESTADO_INICIAL = { empresas: [], publicaciones: [], mensajes: [], clientes: [], spots: [], control: {} };

// IMPORTANTE: 'estado' se comparte por referencia con server.js/scheduler.js,
// asi que SIEMPRE mutamos sus propiedades, nunca reasignamos el objeto.
const estado = JSON.parse(JSON.stringify(ESTADO_INICIAL));

let modo = 'archivo';
let coleccion = null;
let archivos = null; // coleccion de archivos binarios (audios de spots)
let motivo = MONGODB_URI ? '' : 'Falta la variable MONGODB_URI en Render (Environment).';

function aplicar(doc) {
  estado.empresas = doc.empresas || [];
  estado.publicaciones = doc.publicaciones || [];
  estado.mensajes = doc.mensajes || [];
  estado.clientes = doc.clientes || [];
  estado.control = doc.control || {};
  estado.spots = doc.spots || [];
}

function snapshot() {
  return { empresas: estado.empresas, publicaciones: estado.publicaciones, mensajes: estado.mensajes, clientes: estado.clientes, spots: estado.spots, control: estado.control };
}

// Inicializa el almacenamiento. Debe llamarse (await) antes de arrancar el server.
async function iniciar() {
  if (MONGODB_URI) {
    try {
      const { MongoClient } = require('mongodb');
      const client = new MongoClient(MONGODB_URI);
      await client.connect();
      const db = client.db(process.env.MONGODB_DB || 'agente_social');
      coleccion = db.collection('estado');
      archivos = db.collection('archivos');
      const doc = await coleccion.findOne({ _id: 'estado' });
      if (doc) aplicar(doc);
      else await coleccion.updateOne({ _id: 'estado' }, { $set: snapshot() }, { upsert: true });
      modo = 'mongo';
      console.log('[store] Base de datos MongoDB conectada — datos permanentes ✅');
      return;
    } catch (e) {
      console.error('[store] No se pudo conectar a MongoDB, uso archivo local:', e.message);
      // Nunca mostrar la contrasena: se tapa cualquier "usuario:clave@" del mensaje
      motivo = 'No se pudo conectar a MongoDB: ' + String(e.message || e).replace(/\/\/[^@\s]*@/g, '//***@').slice(0, 300);
    }
  }
  // Modo archivo
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    aplicar(JSON.parse(raw));
  } catch (e) {
    // archivo no existe todavia: se queda vacio
  }
  modo = 'archivo';
  console.log('[store] Modo archivo (' + DATA_FILE + ')');
}

function guardar() {
  if (modo === 'mongo' && coleccion) {
    coleccion.updateOne({ _id: 'estado' }, { $set: snapshot() }, { upsert: true }).catch((e) => console.error('[store] error guardando en MongoDB:', e.message));
    return;
  }
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(snapshot(), null, 2), 'utf8');
  } catch (e) {
    console.error('[store] error guardando archivo:', e.message);
  }
}

// ---------- Archivos binarios (MP3 de los spots) ----------
// En MongoDB van a la coleccion 'archivos' (permanentes). En modo archivo, a una carpeta local.
const DIR_ARCHIVOS = path.join(path.dirname(DATA_FILE), 'archivos');
function rutaLocal(nombre) { return path.join(DIR_ARCHIVOS, nombre.replace(/[^a-zA-Z0-9._-]/g, '_')); }

async function guardarArchivo(nombre, buffer, tipo) {
  if (modo === 'mongo' && archivos) {
    await archivos.updateOne({ _id: nombre }, { $set: { data: buffer, tipo, bytes: buffer.length, creado: new Date() } }, { upsert: true });
    return;
  }
  fs.mkdirSync(DIR_ARCHIVOS, { recursive: true });
  fs.writeFileSync(rutaLocal(nombre), buffer);
}

async function leerArchivo(nombre) {
  if (modo === 'mongo' && archivos) {
    const doc = await archivos.findOne({ _id: nombre });
    if (!doc) return null;
    return Buffer.from(doc.data.buffer ? doc.data.buffer : doc.data);
  }
  try { return fs.readFileSync(rutaLocal(nombre)); } catch (e) { return null; }
}

async function borrarArchivo(nombre) {
  if (modo === 'mongo' && archivos) { await archivos.deleteOne({ _id: nombre }); return; }
  try { fs.unlinkSync(rutaLocal(nombre)); } catch (e) {}
}

function id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

module.exports = { estado, guardar, id, iniciar, guardarArchivo, leerArchivo, borrarArchivo, get modo() { return modo; }, get motivo() { return modo === 'mongo' ? '' : motivo; } };
