/**
 * Paleta y tipografía del sitio público.
 *
 * Deliberadamente NO es la del sistema de operación. Ese vive en pantalla de
 * oficina, con parchment claro y verde bosque, y está hecho para trabajar ocho
 * horas sin cansar la vista. Este otro se mira dos minutos desde un celular en
 * un aeropuerto y tiene que dar ganas de jugar.
 *
 * Los colores salen del logotipo: la copa de la parota son manchas translúcidas
 * encimadas en turquesa, lima y verde limón. De ahí la sombra profunda del
 * fondo (estás debajo del árbol) y los verdes de la copa como luz que se cuela.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Debajo de la copa: la base de toda la pantalla.
        sombra: '#0A2A21',
        'sombra-honda': '#061913',
        'sombra-clara': '#143A2E',
        // El pasto segado. Es el color de las acciones: jugar es el verbo.
        calle: '#1F6B4F',
        'calle-viva': '#2A8A66',
        // Las tres manchas del logotipo.
        copa: '#4FB3A8',
        hoja: '#B7D44A',
        brote: '#DCE86B',
        // La arena del búnker, que es también el papel de la tarjeta.
        arena: '#F2EBDC',
        'arena-honda': '#DFD3B8',
        'arena-raya': '#C8B994',
        tinta: '#0C1A15',
        // Para lo que hay que leer antes de seguir: un apartado por vencer,
        // una tarjeta rechazada, un día que no acepta partidas abiertas.
        'estado-aviso': '#E8C25A',
        'estado-aviso-fondo': 'rgba(232, 194, 90, 0.10)',
      },
      fontFamily: {
        // Fraunces tiene la calidez un poco irregular de la madera y la hoja;
        // Playfair, que usa el sistema, se sentiría de banco aquí.
        titulo: ['Fraunces', 'Georgia', 'serif'],
        texto: ['Karla', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'rotulo-xl': ['clamp(2.75rem, 7vw, 5.25rem)', { lineHeight: '0.92', letterSpacing: '-0.03em' }],
        'rotulo-lg': ['clamp(1.9rem, 3.6vw, 2.9rem)', { lineHeight: '1.04', letterSpacing: '-0.02em' }],
        'rotulo-md': ['1.45rem', { lineHeight: '1.2', letterSpacing: '-0.01em' }],
        'dato-xl': ['2.6rem', { lineHeight: '1', letterSpacing: '-0.02em' }],
        parrafo: ['1.0625rem', { lineHeight: '1.65' }],
        menudo: ['0.8125rem', { lineHeight: '1.5' }],
        cifra: ['0.75rem', { lineHeight: '1.3', letterSpacing: '0.08em' }],
      },
      maxWidth: {
        lectura: '58ch',
      },
      transitionTimingFunction: {
        // Una bola que rueda no arranca de golpe ni frena en seco.
        rodada: 'cubic-bezier(0.33, 0.02, 0.18, 1)',
      },
    },
  },
  plugins: [],
};
