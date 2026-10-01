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

const VERSION = 2;
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
				pendientes.push(`${vistos.get(normalizar(titulo))} y ${p.url} tienen el mismo título «${titulo}». Cada página necesita el suyo.`);
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
};

const NECESITAN_SITIO = new Set([
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
