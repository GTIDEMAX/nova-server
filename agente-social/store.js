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

const ESTADO_INICIAL = { empresas: [], publicaciones: [], mensajes: [] };

// IMPORTANTE: 'estado' se comparte por referencia con server.js/scheduler.js,
// asi que SIEMPRE mutamos sus propiedades, nunca reasignamos el objeto.
const estado = JSON.parse(JSON.stringify(ESTADO_INICIAL));

let modo = 'archivo';
let coleccion = null;

function aplicar(doc) {
  estado.empresas = doc.empresas || [];
  estado.publicaciones = doc.publicaciones || [];
  estado.mensajes = doc.mensajes || [];
}

function snapshot() {
  return { empresas: estado.empresas, publicaciones: estado.publicaciones, mensajes: estado.mensajes };
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
      const doc = await coleccion.findOne({ _id: 'estado' });
      if (doc) aplicar(doc);
      else await coleccion.updateOne({ _id: 'estado' }, { $set: snapshot() }, { upsert: true });
      modo = 'mongo';
      console.log('[store] Base de datos MongoDB conectada — datos permanentes ✅');
      return;
    } catch (e) {
      console.error('[store] No se pudo conectar a MongoDB, uso archivo local:', e.message);
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

function id() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

module.exports = { estado, guardar, id, iniciar, get modo() { return modo; } };
