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
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = 5;
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

// Con node:https y sin conexión persistente, no con fetch: en Windows, salir con process.exit
// justo después de un fetch hace que Node muestre «Assertion failed … UV_HANDLE_CLOSING».
function descargar(nombre) {
	return new Promise((resolver, rechazar) => {
		const pedido = https.get(URL_CURSO + nombre, { agent: false, timeout: 10000 }, (respuesta) => {
			if (respuesta.statusCode !== 200) {
				respuesta.resume();
				rechazar(new Error(`HTTP ${respuesta.statusCode}`));
				return;
			}
			respuesta.setEncoding('utf8');
			let texto = '';
			respuesta.on('data', (trozo) => (texto += trozo));
			respuesta.on('end', () => resolver(texto));
			respuesta.on('error', rechazar);
		});
		pedido.on('timeout', () => pedido.destroy(new Error('tiempo agotado')));
		pedido.on('error', rechazar);
	});
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

const contarPalabras = (texto) => texto.split(/\s+/).filter((p) => /[\p{L}\p{N}]/u.test(p)).length;

const etiquetasDe = (html, nombre) => html.match(new RegExp(`<${nombre}\\b[^>]*>`, 'gi')) ?? [];

const contenidoDe = (html, nombre) =>
	[...html.matchAll(new RegExp(`<${nombre}\\b[^>]*>([\\s\\S]*?)</${nombre}>`, 'gi'))].map((m) => m[1]);

function atributo(etiqueta, nombre) {
	const m = new RegExp(`\\s${nombre}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(etiqueta);
	return m ? decodificar(m[1] ?? m[2] ?? m[3] ?? '') : null;
}

// Todas las páginas del sitio compilado, menos la 404: [{ url: '/carta/', archivo: 'carta/index.html', html }].
let cachePaginas = null;
function paginas() {
	if (cachePaginas) return cachePaginas;
	const dist = path.join(RAIZ, 'dist');
	const halladas = [];
	const recorrer = (carpeta) => {
		for (const nombre of readdirSync(carpeta)) {
			const ruta = path.join(carpeta, nombre);
			if (statSync(ruta).isDirectory()) {
				if (nombre !== '_astro') recorrer(ruta);
				continue;
			}
			if (!nombre.endsWith('.html')) continue;
			const archivo = path.relative(dist, ruta).split(path.sep).join('/');
			if (/^404(\/index)?\.html$/.test(archivo)) continue;
			const url = '/' + archivo.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '');
			halladas.push({ url, archivo, html: readFileSync(ruta, 'utf8') });
		}
	};
	if (existsSync(dist)) recorrer(dist);
	cachePaginas = halladas.sort((a, b) => a.url.localeCompare(b.url));
	return cachePaginas;
}

// La «base» de astro.config (la semana 8 la pone para GitHub Pages): los enlaces la llevan y dist/ no.
function baseDelSitio() {
	const config = ['astro.config.mjs', 'astro.config.js', 'astro.config.ts']
		.map((n) => path.join(RAIZ, n))
		.find((r) => existsSync(r));
	const m = config && /\bbase\s*:\s*['"`]([^'"`]*)['"`]/.exec(readFileSync(config, 'utf8'));
	const limpia = m ? m[1].replace(/^\/+|\/+$/g, '') : '';
	return limpia ? `/${limpia}/` : '/';
}

// La ruta dentro del sitio a la que lleva un enlace o una imagen, o null si sale del sitio.
function rutaInterna(destino, desde) {
	if (!destino || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(destino.trim())) return null;
	const limpio = destino.trim().split('#')[0].split('?')[0];
	if (!limpio) return null;
	let ruta;
	try {
		ruta = decodeURIComponent(new URL(limpio, `http://sitio${desde}`).pathname);
	} catch {
		return limpio;
	}
	const base = baseDelSitio();
	return base !== '/' && ruta.startsWith(base) ? `/${ruta.slice(base.length)}` : ruta;
}

// El archivo de dist/ que sirve esa ruta, o null si no existe.
function archivoDelSitio(ruta) {
	const dist = path.join(RAIZ, 'dist');
	const rel = ruta.replace(/^\/+/, '');
	for (const candidato of [rel, path.posix.join(rel, 'index.html'), `${rel}.html`]) {
		const completo = path.join(dist, candidato);
		if (candidato && existsSync(completo) && statSync(completo).isFile()) return candidato;
	}
	return null;
}

// Las imágenes de todas las páginas: [{ pagina, etiqueta, src, alt }].
const imagenes = () =>
	paginas().flatMap((p) =>
		etiquetasDe(p.html, 'img').map((etiqueta) => ({
			pagina: p.url,
			src: atributo(etiqueta, 'src') ?? '',
			alt: atributo(etiqueta, 'alt'),
		})),
	);

// Para nombrar una imagen sin la huella que le agrega Astro: /_astro/local.B3x9.webp → local
const nombreImagen = (src) => path.posix.basename(src.split('?')[0]).split('.')[0] || src;

function resultado(total, pendientes) {
	if (!pendientes.length) return { ok: true };
	return {
		ok: false,
		parcial: total ? Math.max(0, (total - pendientes.length) / total) : 0,
		detalle: pendientes.slice(0, 8).join('\n') + (pendientes.length > 8 ? `\n… y ${pendientes.length - 8} más.` : ''),
	};
}

// Las páginas que pide la semana («paginasMinimas» de la rúbrica). Un criterio que se revisa
// página por página cuenta como pendientes las que todavía no existen, para que un sitio de una
// sola página no apruebe lo que se pide en cuatro.
let paginasMinimas = 1;
function resultadoPorPagina(ps, pendientes) {
	if (ps.length >= paginasMinimas) return resultado(ps.length, pendientes);
	return {
		ok: false,
		parcial: Math.max(0, ps.length - pendientes.length) / paginasMinimas,
		detalle: [`Se revisa en ${paginasMinimas} páginas y tu sitio tiene ${ps.length}.`, ...pendientes].join('\n'),
	};
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

// ---------- Ayudas del revisor 3 (semana 3 en adelante): CSS y Tailwind ----------

// Los archivos de una carpeta del proyecto con esas extensiones, sin node_modules ni carpetas ocultas.
function archivosDe(carpeta, extensiones) {
	const hallados = [];
	const recorrer = (dir) => {
		for (const nombre of readdirSync(dir)) {
			if (nombre === 'node_modules' || nombre.startsWith('.')) continue;
			const ruta = path.join(dir, nombre);
			if (statSync(ruta).isDirectory()) recorrer(ruta);
			else if (extensiones.includes(path.extname(nombre).toLowerCase())) hallados.push(ruta);
		}
	};
	const raiz = path.join(RAIZ, carpeta);
	if (existsSync(raiz)) recorrer(raiz);
	return hallados;
}

const rutaVisible = (ruta) => path.relative(RAIZ, ruta).split(path.sep).join('/');

// El CSS que recibe una página: sus hojas enlazadas de dist/ y sus bloques <style>.
function cssDePagina(p) {
	const enlazado = etiquetasDe(p.html, 'link')
		.filter((e) => /\bstylesheet\b/i.test(atributo(e, 'rel') ?? ''))
		.map((e) => rutaInterna(atributo(e, 'href'), p.url))
		.map((ruta) => (ruta ? archivoDelSitio(ruta) : null))
		.filter(Boolean)
		.map((archivo) => readFileSync(path.join(RAIZ, 'dist', archivo), 'utf8'));
	return [...enlazado, ...contenidoDe(p.html, 'style')].join('\n');
}

let cacheCss = null;
const cssDelSitio = () => (cacheCss ??= paginas().map(cssDePagina).join('\n'));

// Los nombres de clase que tienen reglas en el CSS del sitio (.hover\:bg-selva da hover:bg-selva).
let cacheClasesCss = null;
const clasesDelCss = () =>
	(cacheClasesCss ??= new Set([...cssDelSitio().matchAll(/\.((?:\\.|[\w-])+)/g)].map((m) => m[1].replace(/\\(.)/g, '$1'))));

// Los colores y las fuentes que el alumno escribió en @theme, en cualquier .css de src/.
let cacheTema = null;
function temaDelProyecto() {
	if (cacheTema) return cacheTema;
	const tema = { hay: false, colores: [], fuentes: [] };
	for (const archivo of archivosDe('src', ['.css'])) {
		const css = readFileSync(archivo, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
		for (const m of css.matchAll(/@theme\b[^{;]*\{/g)) {
			tema.hay = true;
			const inicio = m.index + m[0].length;
			let nivel = 1;
			let i = inicio;
			while (i < css.length && nivel > 0) {
				if (css[i] === '{') nivel++;
				else if (css[i] === '}') nivel--;
				i++;
			}
			for (const d of css.slice(inicio, i).matchAll(/--(color|font)-([\w-]+)\s*:/g)) {
				if (d[1] === 'font' && d[2].startsWith('weight')) continue;
				const lista = d[1] === 'color' ? tema.colores : tema.fuentes;
				if (!lista.includes(d[2])) lista.push(d[2]);
			}
		}
	}
	return (cacheTema = tema);
}

// ---------- Ayudas del revisor 5 (semana 5 en adelante): molde, componentes y datos ----------

// El código sin comentarios, para que un <slot /> o un import comentado no cuente.
const sinComentarios = (codigo) =>
	codigo
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/^\s*\/\/.*$/gm, '');

// La parte de un .astro que se vuelve HTML, sin el frontmatter de entre los ---.
const plantillaDe = (codigo) => codigo.replace(/^\s*---[\s\S]*?\n---/, '');

const escapar = (texto) => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// La ruta para importar «destino» desde «archivo», como ../layouts/Layout.astro.
function rutaParaImportar(archivo, destino) {
	const relativa = path.relative(path.dirname(archivo), destino).split(path.sep).join('/');
	return relativa.startsWith('.') ? relativa : `./${relativa}`;
}

const nombreDeComponente = (etiqueta) => etiqueta[0].toUpperCase() + etiqueta.slice(1);

// Los arreglos de un archivo de datos (.js, .ts o .json) con los textos de cada objeto que
// tienen: [{ nombre: 'productos', elementos: [['Café pasado', 'Café de altura…'], …] }].
// Lee el código sin ejecutarlo, porque un archivo de datos de Astro puede importar fotos y Node
// solo no sabe importar un .jpg.
function arreglosDeObjetos(archivo) {
	const codigo = readFileSync(archivo, 'utf8');
	const hallados = [];
	if (path.extname(archivo).toLowerCase() === '.json') {
		let datos;
		try {
			datos = JSON.parse(codigo);
		} catch {
			return hallados;
		}
		const textosDe = (v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(textosDe) : []);
		const recorrer = (v) => {
			if (Array.isArray(v)) {
				const objetos = v.filter((e) => e && typeof e === 'object' && !Array.isArray(e));
				hallados.push({ nombre: null, elementos: objetos.map(textosDe) });
				v.forEach(recorrer);
			} else if (v && typeof v === 'object') {
				Object.values(v).forEach(recorrer);
			}
		};
		recorrer(datos);
		return hallados;
	}
	const pila = [];
	const empezarElemento = (esObjeto) => {
		const nivel = pila.at(-1);
		if (nivel?.tipo === '[' && !nivel.actual) nivel.actual = { esObjeto, textos: [] };
	};
	const cerrarElemento = (nivel) => {
		if (nivel.actual?.esObjeto) nivel.elementos.push(nivel.actual.textos);
		nivel.actual = null;
	};
	for (let i = 0; i < codigo.length; i++) {
		const ch = codigo[i];
		if (ch === '/' && codigo[i + 1] === '/') {
			const fin = codigo.indexOf('\n', i);
			i = fin < 0 ? codigo.length : fin;
		} else if (ch === '/' && codigo[i + 1] === '*') {
			const fin = codigo.indexOf('*/', i + 2);
			i = fin < 0 ? codigo.length : fin + 1;
		} else if (ch === '"' || ch === "'" || ch === '`') {
			empezarElemento(false);
			let texto = '';
			let j = i + 1;
			for (; j < codigo.length && codigo[j] !== ch; j++) {
				if (codigo[j] === '\\') j++;
				texto += codigo[j] ?? '';
			}
			for (const nivel of pila) nivel.actual?.textos.push(texto);
			i = j;
		} else if (ch === '[' || ch === '{' || ch === '(') {
			empezarElemento(ch === '{');
			const antes = /(\w+)\s*(?::[^=;]*)?=\s*$/.exec(codigo.slice(Math.max(0, i - 200), i));
			pila.push({ tipo: ch, nombre: antes?.[1] ?? null, elementos: [], actual: null });
		} else if (ch === ']' || ch === '}' || ch === ')') {
			const nivel = pila.pop();
			if (nivel?.tipo === '[') {
				cerrarElemento(nivel);
				hallados.push({ nombre: nivel.nombre, elementos: nivel.elementos });
			}
		} else if (ch === ',') {
			if (pila.at(-1)?.tipo === '[') cerrarElemento(pila.at(-1));
		} else if (!/\s/.test(ch)) {
			empezarElemento(false);
		}
	}
	return hallados;
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

	// Con «archivo» cuenta solo los commits que lo tocan: la plantilla trae uno, así que
	// el mínimo 2 exige un commit propio aunque el alumno haya clonado la plantilla en vez
	// de usar «Use this template».
	commits(c) {
		const ruta = c.archivo ? ['--', c.archivo] : [];
		const r = spawnSync('git', ['rev-list', '--count', 'HEAD', ...ruta], { cwd: RAIZ, encoding: 'utf8' });
		if (r.error || r.status !== 0) {
			return { ok: false, detalle: 'Esta carpeta no está conectada a Git. Clona tu repositorio como dice la guía.' };
		}
		const cantidad = Number(r.stdout.trim());
		if (cantidad >= c.minimo) return { ok: true };
		return { ok: false, detalle: 'Todavía no guardaste tu avance. Haz un commit desde Control de código fuente.' };
	},

	// Desde aquí, criterios del revisor 2 (semana 2 en adelante). Miran todas las páginas de dist/.

	paginas(c) {
		const ps = paginas();
		const pendientes = [];
		if (ps.length < c.minimo) {
			pendientes.push(`El sitio tiene ${ps.length} página(s) y la semana pide ${c.minimo}. Crea las que faltan en src/pages.`);
		}
		let conContenido = 0;
		for (const p of ps) {
			const palabras = contarPalabras(sinEtiquetas(contenidoDe(p.html, c.etiqueta).join(' ')));
			if (palabras >= c.minimoPalabras) conContenido++;
			else pendientes.push(`${p.url} tiene poco contenido dentro de <${c.etiqueta}> (${palabras} palabras). Escribe el contenido real del brief.`);
		}
		if (!pendientes.length) return { ok: true };
		return { ok: false, parcial: Math.min(conContenido, c.minimo) / c.minimo, detalle: pendientes.join('\n') };
	},

	'atributo-html'(c) {
		const ps = paginas();
		const pendientes = ps
			.filter((p) => {
				const valor = atributo(etiquetasDe(p.html, 'html')[0] ?? '', c.atributo) ?? '';
				return !normalizar(valor).startsWith(normalizar(c.valor));
			})
			.map((p) => `En ${p.url} la etiqueta <html> no tiene ${c.atributo}="${c.valor}".`);
		return resultadoPorPagina(ps, pendientes);
	},

	'etiquetas-por-pagina'(c) {
		const ps = paginas();
		const pendientes = [];
		for (const p of ps) {
			const faltan = c.etiquetas.filter((e) => !etiquetasDe(p.html, e).length);
			if (faltan.length) pendientes.push(`A ${p.url} le falta ${faltan.map((e) => `<${e}>`).join(', ')}.`);
		}
		return resultadoPorPagina(ps, pendientes);
	},

	'una-por-pagina'(c) {
		const ps = paginas();
		const pendientes = [];
		for (const p of ps) {
			const textos = contenidoDe(p.html, c.etiqueta).map(sinEtiquetas);
			if (!textos.length) pendientes.push(`${p.url} no tiene <${c.etiqueta}>.`);
			else if (textos.length > 1) pendientes.push(`${p.url} tiene ${textos.length} <${c.etiqueta}>. Deja uno solo, el título principal de la página.`);
			else if (!textos[0]) pendientes.push(`El <${c.etiqueta}> de ${p.url} está vacío.`);
			else if ((c.distintoDe ?? []).some((t) => normalizar(t) === normalizar(textos[0]))) {
				pendientes.push(`El <${c.etiqueta}> de ${p.url} todavía dice «${textos[0]}».`);
			}
		}
		return resultadoPorPagina(ps, pendientes);
	},

	'titulos-unicos'(c) {
		const ps = paginas();
		const pendientes = [];
		const vistos = new Map();
		for (const p of ps) {
			const titulo = sinEtiquetas(contenidoDe(p.html, 'title')[0] ?? '');
			if (!titulo) {
				pendientes.push(`${p.url} no tiene título de pestaña (<title>).`);
			} else if ((c.distintoDe ?? []).some((t) => normalizar(t) === normalizar(titulo))) {
				pendientes.push(`El título de ${p.url} todavía dice «${titulo}».`);
			} else if (vistos.has(normalizar(titulo))) {
				pendientes.push(`${vistos.get(normalizar(titulo))} y ${p.url} tienen el mismo título «${titulo}». Cada página necesita el suyo. Si el título está en el molde de página, que cada página le pase el suyo con title="…".`);
			} else {
				vistos.set(normalizar(titulo), p.url);
			}
		}
		return resultadoPorPagina(ps, pendientes);
	},

	'imagenes-alt'(c) {
		const imgs = imagenes();
		const genericas = new Set((c.genericas ?? []).map(normalizar));
		const pendientes = [];
		if (imgs.length < c.minimo) pendientes.push(`El sitio tiene ${imgs.length} imagen(es) y la semana pide ${c.minimo}.`);
		for (const img of imgs) {
			const alt = (img.alt ?? '').trim();
			const nombre = nombreImagen(img.src);
			if (img.alt === null) pendientes.push(`La imagen «${nombre}» de ${img.pagina} no tiene alt.`);
			else if (!alt) pendientes.push(`La imagen «${nombre}» de ${img.pagina} tiene el alt vacío. Escribe qué se ve en ella.`);
			else if (genericas.has(normalizar(alt)) || /\.(jpe?g|png|webp|avif|gif|svg)$/i.test(alt) || contarPalabras(alt) < 3) {
				pendientes.push(`El alt «${alt}» de ${img.pagina} no describe la imagen. Escribe qué se ve en ella.`);
			}
		}
		return resultado(Math.max(imgs.length, c.minimo), pendientes);
	},

	'imagenes-cargan'() {
		const imgs = imagenes();
		if (!imgs.length) return { ok: false, detalle: 'El sitio todavía no tiene imágenes que revisar.' };
		const pendientes = imgs
			.filter((img) => {
				const ruta = rutaInterna(img.src, img.pagina);
				return ruta !== null && !archivoDelSitio(ruta);
			})
			.map((img) => `La imagen «${img.src}» de ${img.pagina} no carga, porque esa ruta no existe en el sitio. Mira «Si algo falla» en la guía.`);
		return resultado(imgs.length, pendientes);
	},

	'imagenes-optimizadas'(c) {
		const optimizadas = imagenes().filter((img) => (rutaInterna(img.src, img.pagina) ?? '').startsWith('/_astro/')).length;
		if (optimizadas >= c.minimo) return { ok: true };
		return { ok: false, detalle: 'Ninguna imagen pasa por <Image />. Pon tus fotos en src/assets, impórtalas y muéstralas con <Image />.' };
	},

	'enlaces-internos'() {
		const ps = paginas();
		if (ps.length < Math.max(2, paginasMinimas)) {
			return { ok: false, detalle: `El sitio tiene ${ps.length} página(s). Crea las demás y enlázalas desde el menú.` };
		}
		const porArchivo = new Map(ps.map((p) => [p.archivo, p.url]));
		const enlazadas = new Map(ps.map((p) => [p.url, new Set()]));
		const rotos = [];
		let revisados = 0;
		for (const p of ps) {
			for (const etiqueta of etiquetasDe(p.html, 'a')) {
				const href = atributo(etiqueta, 'href');
				const ruta = rutaInterna(href, p.url);
				if (ruta === null) continue;
				revisados++;
				const archivo = archivoDelSitio(ruta);
				if (!archivo) rotos.push(`En ${p.url} el enlace a «${href}» no lleva a ninguna página.`);
				else if (porArchivo.has(archivo) && porArchivo.get(archivo) !== p.url) enlazadas.get(porArchivo.get(archivo)).add(p.url);
			}
		}
		const sueltas = ps.length > 1
			? ps.filter((p) => !enlazadas.get(p.url).size).map((p) => `Ninguna otra página enlaza a ${p.url}. Ponla en el menú de todas las páginas.`)
			: [];
		if (!revisados && ps.length > 1) return { ok: false, detalle: 'Las páginas no tienen enlaces entre ellas. Agrega el menú con <nav>.' };
		return resultado(revisados + ps.length, [...rotos, ...sueltas]);
	},

	'enlaces-con'(c) {
		const hrefs = paginas().flatMap((p) => etiquetasDe(p.html, 'a').map((e) => (atributo(e, 'href') ?? '').trim().toLowerCase()));
		const pendientes = c.enlaces
			.filter((e) => !hrefs.some((h) => e.prefijos.some((pre) => h.startsWith(pre.toLowerCase()))))
			.map((e) => `Falta un enlace ${e.nombre} (empieza con ${e.prefijos[0]}).`);
		return resultado(c.enlaces.length, pendientes);
	},

	'tabla-con-th'() {
		const tablas = paginas().flatMap((p) => contenidoDe(p.html, 'table').map((t) => ({ pagina: p.url, t })));
		if (!tablas.length) return { ok: false, detalle: 'El sitio no tiene ninguna tabla (por ejemplo, de precios o de horarios).' };
		const pendientes = tablas
			.filter(({ t }) => !/<th\b/i.test(t))
			.map(({ pagina }) => `Una tabla de ${pagina} no tiene encabezados <th>.`);
		return resultado(tablas.length, pendientes);
	},

	'iframe-con-title'(c) {
		const marcos = paginas().flatMap((p) => etiquetasDe(p.html, 'iframe').map((e) => ({ pagina: p.url, title: atributo(e, 'title') })));
		const pendientes = [];
		if (marcos.length < c.minimo) pendientes.push('El sitio no tiene el mapa del negocio (un <iframe> de Google Maps).');
		for (const m of marcos) {
			if (!(m.title ?? '').trim()) pendientes.push(`El <iframe> de ${m.pagina} no tiene title. Escribe qué muestra.`);
		}
		return resultado(Math.max(marcos.length, c.minimo), pendientes);
	},

	// Desde aquí, criterios del revisor 3 (semana 3 en adelante): Tailwind y la marca en @theme.

	'tailwind-instalado'() {
		let paquete = {};
		try {
			paquete = JSON.parse(readFileSync(path.join(RAIZ, 'package.json'), 'utf8'));
		} catch {
			// Sin package.json legible, cuenta como no instalado.
		}
		const dependencias = { ...paquete.dependencies, ...paquete.devDependencies };
		if (!dependencias.tailwindcss || !dependencias['@tailwindcss/vite']) {
			return { ok: false, detalle: 'Tailwind no está instalado. Escribe npx astro add tailwind en la terminal y acepta los cambios.' };
		}
		const config = ['astro.config.mjs', 'astro.config.js', 'astro.config.ts']
			.map((n) => path.join(RAIZ, n))
			.find((r) => existsSync(r));
		if (!config || !/tailwindcss\s*\(/.test(readFileSync(config, 'utf8'))) {
			return { ok: false, detalle: 'astro.config.mjs no carga Tailwind. Vuelve a escribir npx astro add tailwind y acepta los cambios.' };
		}
		const ps = paginas();
		const pendientes = ps
			.filter((p) => !/@layer\s+utilities\b/.test(cssDePagina(p)))
			.map((p) => `${p.url} no recibe los estilos de Tailwind. Importa src/styles/global.css en el frontmatter de esa página, o en el de tu molde de página (src/layouts/Layout.astro) si ya lo tienes.`);
		return resultadoPorPagina(ps, pendientes);
	},

	'tema-tailwind'(c) {
		const tema = temaDelProyecto();
		if (!tema.hay) {
			return { ok: false, detalle: 'No encontré @theme en los archivos .css de src. Escríbelo en src/styles/global.css con los colores y la fuente de tu marca.' };
		}
		const css = cssDelSitio();
		const colores = tema.colores.filter((n) => css.includes(`var(--color-${n})`));
		const fuentes = tema.fuentes.filter((n) => css.includes(`var(--font-${n})`));
		const pendientes = [];
		if (tema.colores.length < c.minimoColores) {
			pendientes.push(`En @theme hay ${tema.colores.length} color(es) y la semana pide ${c.minimoColores}. Agrega los de tu marca con --color-nombre.`);
		} else if (colores.length < c.minimoColores) {
			const ejemplo = tema.colores.find((n) => !colores.includes(n));
			pendientes.push(`Usas ${colores.length} de los colores de @theme y la semana pide ${c.minimoColores}. Ponlos en tus páginas con clases como bg-${ejemplo} o text-${ejemplo}.`);
		}
		if (!tema.fuentes.length) pendientes.push('En @theme falta la fuente de tu marca. Agrégala con --font-nombre.');
		else if (!fuentes.length) pendientes.push(`Todavía no usas la fuente de @theme. Ponle la clase font-${tema.fuentes[0]} a tus títulos o al <body>.`);
		return resultado(2, pendientes);
	},

	// Busca una expresión en los archivos de src/, línea por línea (style en línea, colores sueltos…).
	'prohibido-en-src'(c) {
		const regex = new RegExp(c.patron, `${(c.banderas ?? 'i').replace('g', '')}g`);
		const pendientes = [];
		for (const archivo of archivosDe('src', c.extensiones)) {
			readFileSync(archivo, 'utf8')
				.split(/\r?\n/)
				.forEach((linea, i) => {
					for (const m of linea.matchAll(regex)) {
						pendientes.push(`En ${rutaVisible(archivo)}, línea ${i + 1}, ${c.mensaje.replace('{texto}', m[0].trim())}`);
					}
				});
		}
		if (!pendientes.length) return { ok: true };
		const r = resultado(pendientes.length, pendientes);
		return { ok: false, parcial: 0, detalle: [r.detalle, c.consejo].filter(Boolean).join('\n') };
	},

	// Una clase con un nombre de @theme que Tailwind no generó. Casi siempre es una clase armada
	// pegando textos ("bg-" + color): Tailwind lee el código buscando clases completas y no la ve.
	'clases-generadas'() {
		const tema = temaDelProyecto();
		const nombres = [...tema.colores, ...tema.fuentes];
		if (!nombres.length) return { ok: false, detalle: 'Primero escribe los colores y la fuente de tu marca en @theme.' };
		const delTema = new RegExp(`-(?:${nombres.join('|')})(?:/\\d{1,3})?$`);
		const enCss = clasesDelCss();
		const vistas = new Set();
		const pendientes = [];
		for (const p of paginas()) {
			for (const m of p.html.matchAll(/\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
				for (const clase of (m[1] ?? m[2]).split(/\s+/).filter(Boolean)) {
					const base = clase.split(':').pop().replace(/^!|!$/g, '').replace(/^-/, '');
					if (!delTema.test(base) || vistas.has(clase)) continue;
					vistas.add(clase);
					if (!enCss.has(clase)) {
						pendientes.push(`En ${p.url} la clase ${clase} no tiene estilos, porque Tailwind no la encontró escrita en tu código. Si la armaste pegando textos ("bg-" + color), escríbela completa.`);
					}
				}
			}
		}
		if (!vistas.size) return { ok: false, detalle: 'Todavía no usas en tus páginas ninguna clase con los nombres de @theme.' };
		return resultado(vistas.size, pendientes);
	},

	// Desde aquí, criterios del revisor 4 (semana 4 en adelante): maquetación para celular y computadora.

	// Cada página lleva <meta name="viewport"> con width=device-width e initial-scale=1, sin impedir el zoom.
	'meta-viewport'() {
		const ps = paginas();
		const pendientes = [];
		for (const p of ps) {
			const meta = etiquetasDe(p.html, 'meta').find((e) => (atributo(e, 'name') ?? '').toLowerCase() === 'viewport');
			if (!meta) {
				pendientes.push(`${p.url} no tiene la etiqueta <meta name="viewport"> dentro de su <head>.`);
				continue;
			}
			const contenido = (atributo(meta, 'content') ?? '').toLowerCase().replace(/\s+/g, '');
			const faltan = [
				contenido.split(',').includes('width=device-width') ? null : 'width=device-width',
				/(?:^|,)initial-scale=1(?:\.0*)?(?:,|$)/.test(contenido) ? null : 'initial-scale=1',
			].filter(Boolean);
			if (faltan.length) {
				pendientes.push(`En ${p.url} el viewport dice «${atributo(meta, 'content')}» y le falta ${faltan.join(' y ')}.`);
			} else if (/user-scalable=(?:no|0)/.test(contenido) || /maximum-scale=1(?:\.0*)?(?:,|$)/.test(contenido)) {
				pendientes.push(`En ${p.url} el viewport impide ampliar la página con los dedos. Quita user-scalable y maximum-scale.`);
			}
		}
		return resultadoPorPagina(ps, pendientes);
	},

	// Elementos cuyo class tiene a la vez las clases que pide «todas» (expresiones que se prueban
	// contra cada clase con su prefijo, como md:grid-cols-2). Con «porPagina» se exige en cada
	// página y con «dentro» solo se mira dentro de esa etiqueta, por ejemplo main.
	clases(c) {
		const patrones = c.todas.map((p) => new RegExp(p));
		const cuenta = (html) => {
			let n = 0;
			for (const m of html.matchAll(/\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
				const lista = (m[1] ?? m[2]).split(/\s+/).filter(Boolean);
				if (patrones.every((re) => lista.some((clase) => re.test(clase)))) n++;
			}
			return n;
		};
		const zona = (p) => (c.dentro ? contenidoDe(p.html, c.dentro).join('\n') : p.html);
		const minimo = c.minimo ?? 1;
		const ps = paginas();
		if (!c.porPagina) {
			return ps.reduce((n, p) => n + cuenta(zona(p)), 0) >= minimo ? { ok: true } : { ok: false, detalle: c.falta };
		}
		const pendientes = ps.filter((p) => cuenta(zona(p)) < minimo).map((p) => c.falta.replace('{pagina}', p.url));
		return resultadoPorPagina(ps, pendientes);
	},

	// Capturas de pantalla en una carpeta del proyecto, una por página y por ancho. El ancho sale
	// del nombre (inicio-375.png) y se comprueba con la medida real de la imagen, que viene
	// multiplicada por la escala de la pantalla (1, 1,25, 1,5, 2…). Si la página se sale a lo
	// ancho, la captura de página completa sale más ancha y tampoco cuadra.
	capturas(c) {
		const carpeta = path.join(RAIZ, c.carpeta);
		const archivos = existsSync(carpeta) ? readdirSync(carpeta).filter((n) => /\.(?:png|jpe?g)$/i.test(n)) : [];
		const pedidas = c.minimoPorAncho ?? paginasMinimas;
		const pendientes = [];
		for (const ancho of c.anchos) {
			const delAncho = archivos.filter((n) => new RegExp(`(?:^|\\D)${ancho}(?:\\D|$)`).test(n));
			for (const nombre of delAncho) {
				const medida = medidaDeImagen(path.join(carpeta, nombre));
				if (!medida) {
					pendientes.push(`No pude leer la imagen ${c.carpeta}/${nombre}. Vuelve a guardarla como PNG.`);
					continue;
				}
				const escala = medida.ancho / ancho;
				if (!ESCALAS_DE_PANTALLA.some((e) => Math.abs(escala - e) / e <= 0.03)) {
					pendientes.push(`La captura ${c.carpeta}/${nombre} mide ${medida.ancho} px de ancho y no corresponde a una pantalla de ${ancho} px. Tómala con el ancho en ${ancho}; si el ancho estaba bien, algo de esa página se sale a lo ancho.`);
				}
			}
			if (delAncho.length < pedidas) {
				pendientes.push(`En la carpeta ${c.carpeta} hay ${delAncho.length} captura(s) a ${ancho} px y la semana pide ${pedidas}, una por página. El nombre de cada una lleva el ancho, por ejemplo inicio-${ancho}.png.`);
			}
		}
		return resultado(pedidas * c.anchos.length, pendientes);
	},

	// Desde aquí, criterios del revisor 5 (semana 5 en adelante). Miran el código de src/ y, el
	// catálogo, también el sitio compilado.

	// El molde de página: un .astro de src/layouts con el <head> y un <slot />, y cada página de
	// src/pages lo importa y envuelve su contenido en él, sin escribir otra vez su propio <head>.
	molde(c) {
		const carpeta = c.carpeta ?? 'src/layouts';
		const moldes = archivosDe(carpeta, ['.astro']);
		if (!moldes.length) {
			return {
				ok: false,
				detalle: `No hay ningún molde de página en ${carpeta}. Crea ${carpeta}/Layout.astro con el <html>, el <head> y un <slot /> donde va el contenido de cada página.`,
			};
		}
		const pendientes = [];
		for (const molde of moldes) {
			const codigo = sinComentarios(readFileSync(molde, 'utf8'));
			if (!/<slot\b/i.test(codigo)) {
				pendientes.push(`${rutaVisible(molde)} no tiene <slot />. Sin él, el contenido de las páginas no aparece. Escribe <slot /> entre la cabecera y el pie.`);
			}
			if (!/<head\b/i.test(codigo)) {
				pendientes.push(`${rutaVisible(molde)} no tiene el <head>. Muévelo ahí desde tus páginas, con el <title> que llega por props.`);
			}
		}
		const nombres = moldes.map((m) => path.basename(m));
		const paginasSrc = archivosDe('src/pages', ['.astro', '.md', '.mdx']).filter((r) => !path.basename(r).startsWith('_'));
		for (const p of paginasSrc) {
			const codigo = sinComentarios(readFileSync(p, 'utf8'));
			const ruta = rutaParaImportar(p, moldes[0]);
			if (path.extname(p).toLowerCase() !== '.astro') {
				const encabezado = /^\s*---([\s\S]*?)\n---/.exec(codigo)?.[1] ?? '';
				const layout = /^\s*layout\s*:\s*['"]?([^'"\n]+)/m.exec(encabezado)?.[1].trim();
				if (!layout || !nombres.includes(path.posix.basename(layout))) {
					pendientes.push(`${rutaVisible(p)} no usa el molde. En su encabezado, entre los ---, escribe layout: ${ruta}`);
				}
				continue;
			}
			const importados = [...codigo.matchAll(/import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g)]
				.filter((m) => nombres.includes(path.posix.basename(m[2])))
				.map((m) => m[1]);
			const plantilla = plantillaDe(codigo);
			if (!importados.some((n) => new RegExp(`<${n}[\\s>/]`).test(plantilla))) {
				pendientes.push(`${rutaVisible(p)} no usa el molde. Entre los --- escribe import Layout from '${ruta}'; y envuelve todo el contenido en <Layout title="…"> y </Layout>.`);
			} else if (/<(?:html|head)\b/i.test(plantilla)) {
				pendientes.push(`${rutaVisible(p)} todavía escribe su propio <html> o <head>. Bórralos, porque ahora los pone el molde.`);
			}
		}
		return resultado(moldes.length * 2 + paginasSrc.length, pendientes);
	},

	// Etiquetas que viven en un componente (la cabecera y el pie): cada una está en un .astro de
	// src/components, ese componente se importa en el molde o en las páginas y ninguna página
	// vuelve a escribir la etiqueta por su cuenta.
	componentes(c) {
		const carpeta = c.carpeta ?? 'src/components';
		const leer = (r) => ({ ruta: r, codigo: sinComentarios(readFileSync(r, 'utf8')) });
		const componentes = archivosDe(carpeta, ['.astro']).map(leer);
		const usuarios = archivosDe('src', ['.astro', '.md', '.mdx']).map(leer);
		const paginasSrc = archivosDe('src/pages', ['.astro']).filter((r) => !path.basename(r).startsWith('_')).map(leer);
		const pendientes = [];
		for (const etiqueta of c.etiquetas) {
			const tiene = (a) => new RegExp(`<${etiqueta}\\b`, 'i').test(plantillaDe(a.codigo));
			const con = componentes.filter(tiene);
			const sugerido = nombreDeComponente(etiqueta);
			if (!con.length) {
				pendientes.push(`Ningún componente de ${carpeta} tiene el <${etiqueta}>. Crea ${carpeta}/${sugerido}.astro y pasa ahí el <${etiqueta}> de tus páginas.`);
				continue;
			}
			const usado = con.some((comp) => {
				const importa = new RegExp(`from\\s*['"][^'"]*/${escapar(path.basename(comp.ruta))}['"]`);
				return usuarios.some((u) => u.ruta !== comp.ruta && importa.test(u.codigo));
			});
			const nombre = path.basename(con[0].ruta, '.astro');
			if (!usado) {
				pendientes.push(`${rutaVisible(con[0].ruta)} no se usa en ninguna parte. Impórtalo en tu molde (src/layouts/Layout.astro) y escribe <${nombre} /> donde va el <${etiqueta}>.`);
			}
			for (const p of paginasSrc.filter(tiene)) {
				pendientes.push(`${rutaVisible(p.ruta)} todavía escribe su propio <${etiqueta}>. Bórralo, porque ahora lo pone el componente ${nombre}.`);
			}
		}
		return resultado(c.etiquetas.length * (1 + paginasSrc.length), pendientes);
	},

	// Un catálogo que sale de un archivo de datos: en src/data hay un arreglo con «minimo» objetos o
	// más, un archivo de src/ lo importa y lo recorre con .map() (con «componente», pintando un
	// componente de src/components por cada objeto) y el sitio compilado muestra esos elementos.
	catalogo(c) {
		const carpeta = c.carpeta ?? 'src/data';
		const minimo = c.minimo ?? 4;
		const archivos = archivosDe(carpeta, ['.js', '.mjs', '.ts', '.json']);
		if (!archivos.length) {
			return {
				ok: false,
				detalle: `No hay ningún archivo de datos en ${carpeta}. Crea ${carpeta}/productos.js con un arreglo de tus productos o servicios, un objeto { } por cada uno.`,
			};
		}
		let mejor = { archivo: null, nombre: null, elementos: [] };
		for (const archivo of archivos) {
			for (const a of arreglosDeObjetos(archivo)) {
				if (a.elementos.length > mejor.elementos.length) mejor = { archivo, ...a };
			}
		}
		if (mejor.elementos.length < minimo) {
			return {
				ok: false,
				detalle: mejor.archivo
					? `El arreglo más largo de ${rutaVisible(mejor.archivo)} tiene ${mejor.elementos.length} objeto(s) y la semana pide ${minimo}. Agrega un objeto { } por cada producto o servicio que falte.`
					: `Los archivos de ${carpeta} no tienen un arreglo de objetos. Escribe uno como export const productos = [{ nombre: '…' }, { nombre: '…' }];`,
			};
		}
		const datos = rutaVisible(mejor.archivo);
		const lista = mejor.nombre ?? 'productos';
		const base = path.basename(mejor.archivo).replace(/\.[^.]+$/, '');
		const importa = new RegExp(`from\\s*['"][^'"]*/${escapar(base)}(?:\\.(?:[cm]?[jt]s|json))?['"]`);
		const usuarios = archivosDe('src', ['.astro', '.jsx', '.tsx', '.mdx'])
			.map((r) => ({ ruta: r, codigo: sinComentarios(readFileSync(r, 'utf8')) }))
			.filter((u) => importa.test(u.codigo));
		const conMap = usuarios.filter((u) => /\.map\s*\(/.test(u.codigo));
		const pendientes = [];
		if (!usuarios.length) {
			pendientes.push(`Ninguna página usa ${datos}. En la página del catálogo, entre los ---, escribe import { ${lista} } from '…/data/${path.basename(mejor.archivo)}'; con la ruta hasta tu archivo.`);
		} else if (!conMap.length) {
			pendientes.push(`${rutaVisible(usuarios[0].ruta)} importa los datos pero no los recorre. Escribe {${lista}.map((item) => ( … ))} donde van las tarjetas.`);
		}
		if (c.componente && conMap.length) {
			const pintaComponente = conMap.some((u) =>
				[...u.codigo.matchAll(/\.map\s*\(/g)].some((m) => {
					const etiqueta = /<([A-Z]\w*)/.exec(u.codigo.slice(m.index, m.index + 600))?.[1];
					return etiqueta && new RegExp(`import\\s+${etiqueta}\\s+from\\s*['"][^'"]*components/`).test(u.codigo);
				}),
			);
			if (!pintaComponente) {
				pendientes.push(`El .map() de ${rutaVisible(conMap[0].ruta)} no pinta un componente. Pasa la tarjeta a src/components/Tarjeta.astro y en el .map() escribe <Tarjeta … /> con los datos de cada objeto como props.`);
			}
		}
		const textoDelSitio = normalizar(
			paginas()
				.map((p) => [sinEtiquetas(p.html), ...etiquetasDe(p.html, 'img').map((e) => atributo(e, 'alt') ?? '')].join(' '))
				.join(' '),
		);
		const visibles = mejor.elementos.filter((textos) =>
			textos
				.map(normalizar)
				.some((t) => t.length >= 4 && !/^(?:[./#]|https?:|mailto:|tel:)/.test(t) && textoDelSitio.includes(t)),
		).length;
		if (visibles < minimo) {
			pendientes.push(`En el sitio se ven ${visibles} de los ${mejor.elementos.length} objetos de ${datos} y la semana pide ${minimo}. Revisa que el .map() devuelva una tarjeta por cada objeto.`);
		}
		return resultado(3, pendientes);
	},
};

const ESCALAS_DE_PANTALLA = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.625, 3, 3.5, 4];

// El ancho y el alto de una imagen PNG o JPG, leídos de su cabecera, o null si no se entiende.
function medidaDeImagen(ruta) {
	const b = readFileSync(ruta);
	if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { ancho: b.readUInt32BE(16), alto: b.readUInt32BE(20) };
	if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
		let i = 2;
		while (i + 9 < b.length) {
			if (b[i] !== 0xff) return null;
			const marca = b[i + 1];
			if (marca === 0xff) {
				i++;
				continue;
			}
			if (marca === 0x01 || (marca >= 0xd0 && marca <= 0xd8)) {
				i += 2;
				continue;
			}
			if (marca >= 0xc0 && marca <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marca)) {
				return { alto: b.readUInt16BE(i + 5), ancho: b.readUInt16BE(i + 7) };
			}
			i += 2 + b.readUInt16BE(i + 2);
		}
	}
	return null;
}

const NECESITAN_SITIO = new Set([
	'meta-viewport',
	'clases',
	'tailwind-instalado',
	'tema-tailwind',
	'clases-generadas',
	'etiqueta-texto',
	'paginas',
	'atributo-html',
	'etiquetas-por-pagina',
	'una-por-pagina',
	'titulos-unicos',
	'imagenes-alt',
	'imagenes-cargan',
	'imagenes-optimizadas',
	'enlaces-internos',
	'enlaces-con',
	'tabla-con-th',
	'iframe-con-title',
	'catalogo',
]);

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
paginasMinimas = rubrica.paginasMinimas ?? 1;

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
	} else if (NECESITAN_SITIO.has(c.tipo) && c.tipo !== 'etiqueta-texto' && !paginas().length) {
		r = { ok: false, detalle: 'No se generó ninguna página. Revisa que src/pages tenga tus archivos .astro.' };
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

// Con algo que falta el puntaje no llega a 100: el redondeo de 99,8 mostraba «100 de 100» y «Todo cuadra» bajo un «Falta».
const todoCuadra = resultados.every(({ r }) => r.ok);
const final = todoCuadra ? 100 : Math.min(99, Math.round((puntaje / total) * 100));
console.log(`\n${negrita(`Puntaje ${final} de 100`)}`);
if (todoCuadra) {
	console.log(verde('Todo cuadra. Si cambiaste algo después del último commit, haz otro y súbelo.'));
} else {
	console.log(`Corrige lo que falta y vuelve a escribir npm run revisar -- ${rubrica.semana}`);
}
const pendientes = commitsSinSubir();
if (pendientes > 0) {
	console.log(rojo(`Tienes ${pendientes} commit(s) sin subir a GitHub. Pulsa Sync Changes (Sincronizar cambios).`));
}
console.log('');
