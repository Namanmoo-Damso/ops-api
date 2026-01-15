import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AdminOrganizationGuard } from '../../common/guards/admin-organization.guard';
import { BulletinsService } from './bulletins.service';
import { CreateBulletinDto, UpdateBulletinDto } from './dto';

@Controller('v1/admin/bulletins')
@UseGuards(AdminOrganizationGuard)
export class BulletinsController {
  private readonly logger = new Logger(BulletinsController.name);

  constructor(private readonly bulletinsService: BulletinsService) {}

  /**
   * GET /v1/admin/bulletins
   * List all bulletins for the organization
   */
  @Get()
  async list(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const organizationId = req.admin?.organizationId;
    if (!organizationId) {
      return {
        data: [],
        pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
      };
    }

    return this.bulletinsService.list(
      organizationId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 10,
    );
  }

  /**
   * GET /v1/admin/bulletins/:id
   * Get a single bulletin
   */
  @Get(':id')
  async get(@Req() req: any, @Param('id') id: string) {
    const organizationId = req.admin?.organizationId;
    if (!organizationId) {
      return null;
    }

    return this.bulletinsService.get(id, organizationId);
  }

  /**
   * POST /v1/admin/bulletins
   * Create a new bulletin
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Req() req: any, @Body() body: CreateBulletinDto) {
    const organizationId = req.admin?.organizationId;
    const authorId = req.admin?.id;

    if (!organizationId || !authorId) {
      throw new Error('Organization or author not found');
    }

    return this.bulletinsService.create(organizationId, authorId, body);
  }

  /**
   * PUT /v1/admin/bulletins/:id
   * Update a bulletin
   */
  @Put(':id')
  async update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: UpdateBulletinDto,
  ) {
    const organizationId = req.admin?.organizationId;
    if (!organizationId) {
      throw new Error('Organization not found');
    }

    return this.bulletinsService.update(id, organizationId, body);
  }

  /**
   * DELETE /v1/admin/bulletins/:id
   * Delete a bulletin
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async delete(@Req() req: any, @Param('id') id: string) {
    const organizationId = req.admin?.organizationId;
    if (!organizationId) {
      throw new Error('Organization not found');
    }

    return this.bulletinsService.delete(id, organizationId);
  }
}
