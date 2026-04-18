import { HTTPController, HTTPMethod, HTTPMethodEnum } from '@eggjs/tegg';

@HTTPController({
  path: '/',
})
export class HomeController {
  @HTTPMethod({
    method: HTTPMethodEnum.GET,
    path: '/',
  })
  async index() {
    return { message: 'Hello, Egg.js!' };
  }
}
