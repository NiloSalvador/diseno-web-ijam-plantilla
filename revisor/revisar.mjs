// Revisor del curso Diseño Web IJAM.
//
// Uso:  npm run revisar -- 1            revisa la entrega de la semana 1
//       npm run revisar -- actualizar   descarga la versión nueva del revisor
//
// Compila el sitio y comprueba la rúbrica de la semana (revisor/semana-N.json).
// Dice qué falta, nunca la respuesta. Solo usa lo que trae Node: no instala nada.
// La rúbrica se descarga del repositorio del curso cada vez (si hay internet), así
// siempre se revisa con la versión vigente; sin internet, usa la copia local.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 1;
const CARPETA_REVISOR = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(CARPETA_REVISOR, '..');
const URL_CURSO = 'https://raw.githubusercontent.com/NiloSalvador/diseno-web-ijam/main/revisor/';

const conColor = process.stdout.isTTY && !process.env.NO_COLOR;
const pintar = (codigo) => (texto) => (conColor ? `\x1b[${codigo}m${texto}\x1b[0m` : texto);
const verde = pintar(32);
const rojo = pintar(31);
const negrita = pintar(1);

function terminar(mensaje) {
	console.log(`\n${mensaje}\n`);
	process.exit(0);
}

async function descargar(nombre) {
	const respuesta = await fetch(URL_CURSO + nombre, { signal: AbortSignal.timeout(10000) });
	if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
	return respuesta.text();
}

async function actualizarRevisor() {
	try {
		const codigo = await descargar('revisar.mjs');
		if (!codigo.includes('Revisor del curso Diseño Web IJAM')) throw new Error('contenido inesperado');
		writeFileSync(fileURLToPath(import.meta.url), codigo);
		terminar(verde('Revisor actualizado. Vuelve a escribir el comando de tu semana.'));
	} catch {
		terminar(rojo('No pude descargar el revisor nuevo. Revisa tu conexión a internet y vuelve a intentarlo.'));
	}
}

function semanasLocales() {
	return readdirSync(CARPETA_REVISOR)
		.map((nombre) => /^semana-(\d+)\.json$/.exec(nombre))
		.filter(Boolean)
		.map((m) => Number(m[1]))
		.sort((a, b) => a - b);
}

async function cargarRubrica(semana) {
	const nombre = `semana-${semana}.json`;
	const local = path.join(CARPETA_REVISOR, nombre);
	try {
		const texto = await descargar(nombre);
		JSON.parse(texto);
		writeFileSync(local, texto);
	} catch {
		// Sin internet o la semana todavía no está publicada: se usa la copia local si existe.
	}
	if (!existsSync(local)) {
		terminar(rojo(`No encontré la rúbrica de la semana ${semana}. Revisa tu conexión a internet o si esa semana ya empezó.`));
	}
	return JSON.parse(readFileSync(local, 'utf8'));
}

// ---------- Ayudas ----------

const normalizar = (texto) =>
	texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

const decodificar = (texto) =>
	texto
		.replace(/&nbsp;/g, ' ')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/&amp;/g, '&');

const sinEtiquetas = (html) => decodificar(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function leerPagina(archivo) {
	const ruta = path.join(RAIZ, 'dist', archivo);
	return existsSync(ruta) ? readFileSync(ruta, 'utf8') : null;
}

function compilar() {
	if (!existsSync(path.join(RAIZ, 'node_modules', 'astro'))) {
		return { ok: false, detalle: 'Faltan las dependencias. Escribe npm install y vuelve a intentarlo.' };
	}
	const r = spawnSync('npm run build', { cwd: RAIZ, shell: true, encoding: 'utf8' });
	if (r.status === 0) return { ok: true };
	const lineas = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.split(/\r?\n/).filter((l) => l.trim());
	return {
		ok: false,
		detalle: ['Astro no pudo generar el sitio. Estas son sus últimas líneas', ...lineas.slice(-12)].join('\n'),
	};
}

// ---------- Tipos de criterio ----------
// Cada uno devuelve { ok, parcial (0 a 1, opcional), detalle (qué falta, opcional) }.

const CRITERIOS = {
	'etiqueta-texto'(c) {
		const html = leerPagina(c.archivo);
		if (html === null) return { ok: false, detalle: `No se generó la página ${c.archivo}.` };
		const m = new RegExp(`<${c.etiqueta}\\b[^>]*>([\\s\\S]*?)</${c.etiqueta}>`, 'i').exec(html);
		if (!m) return { ok: false, detalle: `La página no tiene la etiqueta <${c.etiqueta}>.` };
		const texto = sinEtiquetas(m[1]);
		if (!texto) return { ok: false, detalle: `La etiqueta <${c.etiqueta}> está vacía.` };
		const prohibido = (c.distintoDe ?? []).find((t) => normalizar(t) === normalizar(texto));
		if (prohibido) return { ok: false, detalle: `Todavía dice «${texto}».` };
		return { ok: true };
	},

	'apartados-markdown'(c) {
		const ruta = path.join(RAIZ, c.archivo);
		if (!existsSync(ruta)) return { ok: false, detalle: `No encuentro el archivo ${c.archivo}.` };
		const secciones = new Map();
		let actual = null;
		for (const linea of readFileSync(ruta, 'utf8').split(/\r?\n/)) {
			const titulo = /^##\s+(.+?)\s*$/.exec(linea);
			if (titulo) {
				actual = normalizar(titulo[1]);
				secciones.set(actual, []);
			} else if (actual) {
				secciones.get(actual).push(linea);
			}
		}
		const pendientes = [];
		for (const apartado of c.apartados) {
			const lineas = secciones.get(normalizar(apartado));
			if (!lineas) {
				pendientes.push(`Falta el apartado «${apartado}».`);
				continue;
			}
			const conMarcador = lineas.some((l) => l.includes(c.marcador));
			const palabras = lineas
				.filter((l) => !l.includes(c.marcador))
				.join(' ')
				.split(/\s+/)
				.filter((p) => /[\p{L}\p{N}]/u.test(p)).length;
			if (palabras < c.minimoPalabras) pendientes.push(`«${apartado}» todavía está sin escribir.`);
			else if (conMarcador) pendientes.push(`En «${apartado}» borra la línea de ejemplo «${c.marcador}…».`);
		}
		if (!pendientes.length) return { ok: true };
		return {
			ok: false,
			parcial: (c.apartados.length - pendientes.length) / c.apartados.length,
			detalle: pendientes.join('\n'),
		};
	},

	'archivo-en-carpeta'(c) {
		const ruta = path.join(RAIZ, c.carpeta);
		const minimo = c.minimoBytes ?? 1024;
		const hallados = existsSync(ruta)
			? readdirSync(ruta).filter(
					(n) => c.extensiones.includes(path.extname(n).toLowerCase()) && statSync(path.join(ruta, n)).size >= minimo,
				)
			: [];
		if (hallados.length) return { ok: true };
		return { ok: false, detalle: `No hay ninguna imagen ${c.extensiones.join(', ')} en la carpeta ${c.carpeta}.` };
	},

	commits(c) {
		const r = spawnSync('git', ['rev-list', '--count', 'HEAD'], { cwd: RAIZ, encoding: 'utf8' });
		if (r.error || r.status !== 0) {
			return { ok: false, detalle: 'Esta carpeta no está conectada a Git. Clona tu repositorio como dice la guía.' };
		}
		const cantidad = Number(r.stdout.trim());
		if (cantidad >= c.minimo) return { ok: true };
		return { ok: false, detalle: 'Todavía no guardaste tu avance. Haz un commit desde Control de código fuente.' };
	},
};

const NECESITAN_SITIO = new Set(['etiqueta-texto']);

function commitsSinSubir() {
	const r = spawnSync('git', ['rev-list', '--count', '@{u}..HEAD'], { cwd: RAIZ, encoding: 'utf8' });
	return r.status === 0 ? Number(r.stdout.trim()) : 0;
}

// ---------- Programa ----------

const argumento = (process.argv[2] ?? '').trim().toLowerCase();
if (argumento === 'actualizar') await actualizarRevisor();

let semana = Number(argumento);
if (!argumento) {
	const locales = semanasLocales();
	semana = locales.at(-1);
	if (!semana) terminar('Escribe la semana que quieres revisar, por ejemplo npm run revisar -- 1');
} else if (!Number.isInteger(semana) || semana < 1 || semana > 8) {
	terminar('Escribe la semana con un número del 1 al 8, por ejemplo npm run revisar -- 1');
}

const rubrica = await cargarRubrica(semana);
if ((rubrica.revisorMinimo ?? 1) > VERSION) {
	terminar('Esta semana necesita un revisor más nuevo. Escribe npm run revisar -- actualizar y luego vuelve a revisar.');
}

console.log(`\n${negrita('Revisor de Diseño Web IJAM')}`);
console.log(`Semana ${rubrica.semana} — ${rubrica.titulo}\n`);
console.log('Compilando el sitio, espera unos segundos…\n');

const resultados = [];
let sitio = null;
for (const c of rubrica.criterios) {
	let r;
	if (c.tipo === 'compila') {
		sitio = compilar();
		r = sitio;
	} else if (NECESITAN_SITIO.has(c.tipo) && sitio && !sitio.ok) {
		r = { ok: false, detalle: 'No se pudo revisar porque el sitio no compila.' };
	} else if (CRITERIOS[c.tipo]) {
		r = CRITERIOS[c.tipo](c);
	} else {
		terminar('Esta rúbrica usa una comprobación que tu revisor no conoce. Escribe npm run revisar -- actualizar.');
	}
	resultados.push({ c, r });
}

let puntaje = 0;
let total = 0;
for (const { c, r } of resultados) {
	total += c.puntos;
	puntaje += r.ok ? c.puntos : c.puntos * (r.parcial ?? 0);
	console.log(`  ${r.ok ? verde('Cuadra') : rojo('Falta ')}   ${c.nombre}`);
	if (!r.ok && r.detalle) {
		for (const linea of r.detalle.split('\n')) console.log(`             ${linea}`);
	}
}

const final = Math.round((puntaje / total) * 100);
console.log(`\n${negrita(`Puntaje ${final} de 100`)}`);
if (final === 100) {
	console.log(verde('Todo cuadra. Si cambiaste algo después del último commit, haz otro y súbelo.'));
} else {
	console.log(`Corrige lo que falta y vuelve a escribir npm run revisar -- ${rubrica.semana}`);
}
const pendientes = commitsSinSubir();
if (pendientes > 0) {
	console.log(rojo(`Tienes ${pendientes} commit(s) sin subir a GitHub. Pulsa Sync Changes (Sincronizar cambios).`));
}
console.log('');
