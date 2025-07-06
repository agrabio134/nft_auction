export const backgroundParticlesConfig = {
  background: {
    color: {
      value: "#2E2E2E", // Matches theme background
    },
  },
  fpsLimit: 60,
  particles: {
    number: {
      value: 30, // Low density for performance
      density: {
        enable: true,
        value_area: 800,
      },
    },
    color: {
      value: ["#F06292", "#FFCDD2"], // Pink theme colors
    },
    shape: {
      type: "circle", // Simple dots for Web3 feel
    },
    opacity: {
      value: 0.3, // Subtle opacity
      random: true,
    },
    size: {
      value: 3,
      random: { enable: true, minimumValue: 1 },
    },
    links: {
      enable: true, // Connected nodes for blockchain aesthetic
      distance: 150,
      color: "#FFCDD2", // Subtle pink links
      opacity: 0.2,
    },
    move: {
      enable: true,
      speed: 1, // Slow movement for calm effect
      direction: "none",
      random: true,
      outModes: {
        default: "out",
      },
    },
  },
  detectRetina: true,
};

export const cursorParticlesConfig = {
  particles: {
    number: {
      value: 10, // Few particles for cursor trail
      density: {
        enable: false,
      },
    },
    color: {
      value: "#F06292", // Primary pink
    },
    shape: {
      type: "circle",
    },
    opacity: {
      value: 0.5,
      random: true,
    },
    size: {
      value: 2,
      random: { enable: true, minimumValue: 1 },
    },
    move: {
      enable: true,
      speed: 2,
      direction: "none",
      random: true,
      straight: false,
      outModes: {
        default: "destroy", // Particles disappear after moving
      },
    },
  },
  interactivity: {
    detectsOn: "canvas",
    events: {
      onHover: {
        enable: true,
        mode: "trail", // Particles follow cursor
      },
    },
    modes: {
      trail: {
        delay: 0.005,
        quantity: 5,
      },
    },
  },
  detectRetina: true,
};