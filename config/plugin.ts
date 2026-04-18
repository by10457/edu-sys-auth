import tracerPlugin from '@eggjs/tracer';

export default {
  // enable tracer plugin
  ...tracerPlugin(),

  // enable redis plugin
  redis: {
    enable: true,
    package: 'egg-redis',
  },
};
