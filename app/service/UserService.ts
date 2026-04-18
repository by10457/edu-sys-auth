import { SingletonProto, AccessLevel } from '@eggjs/tegg';

@SingletonProto({
  accessLevel: AccessLevel.PUBLIC,
})
export class UserService {
  // 可通过 this.ctx 访问请求上下文
  // 可通过 this.app.redis 访问 Redis
  async findById(id: string) {
    // TODO: 查询用户逻辑
    return { id, name: 'example' };
  }
}
