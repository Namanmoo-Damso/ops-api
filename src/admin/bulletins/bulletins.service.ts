import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma';

@Injectable()
export class BulletinsService {
  private readonly logger = new Logger(BulletinsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List bulletins for an organization
   */
  async list(organizationId: string, page = 1, pageSize = 10) {
    const skip = (page - 1) * pageSize;

    const [data, total] = await Promise.all([
      this.prisma.bulletin.findMany({
        where: { organizationId },
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
        include: {
          author: {
            select: { id: true, name: true, email: true },
          },
        },
      }),
      this.prisma.bulletin.count({ where: { organizationId } }),
    ]);

    return {
      data: data.map(b => ({
        id: b.id,
        title: b.title,
        content: b.content,
        author: b.author.name || b.author.email,
        authorId: b.authorId,
        isPinned: b.isPinned,
        date: b.createdAt
          .toISOString()
          .split('T')[0]
          .replace(/-/g, '/')
          .slice(5), // MM/DD format
        createdAt: b.createdAt.toISOString(),
        updatedAt: b.updatedAt.toISOString(),
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * Get a single bulletin by ID
   */
  async get(id: string, organizationId: string) {
    const bulletin = await this.prisma.bulletin.findFirst({
      where: { id, organizationId },
      include: {
        author: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!bulletin) {
      throw new NotFoundException('Bulletin not found');
    }

    return {
      id: bulletin.id,
      title: bulletin.title,
      content: bulletin.content,
      author: bulletin.author.name || bulletin.author.email,
      authorId: bulletin.authorId,
      isPinned: bulletin.isPinned,
      date: bulletin.createdAt
        .toISOString()
        .split('T')[0]
        .replace(/-/g, '/')
        .slice(5),
      createdAt: bulletin.createdAt.toISOString(),
      updatedAt: bulletin.updatedAt.toISOString(),
    };
  }

  /**
   * Create a new bulletin
   */
  async create(
    organizationId: string,
    authorId: string,
    data: { title: string; content: string; isPinned?: boolean },
  ) {
    const bulletin = await this.prisma.bulletin.create({
      data: {
        organizationId,
        authorId,
        title: data.title,
        content: data.content,
        isPinned: data.isPinned ?? false,
      },
    });

    this.logger.log(`Created bulletin id=${bulletin.id} org=${organizationId}`);

    return { id: bulletin.id, message: 'Bulletin created successfully' };
  }

  /**
   * Update a bulletin
   */
  async update(
    id: string,
    organizationId: string,
    data: { title?: string; content?: string; isPinned?: boolean },
  ) {
    // Verify bulletin exists in this org
    const existing = await this.prisma.bulletin.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundException('Bulletin not found');
    }

    const updated = await this.prisma.bulletin.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.content !== undefined && { content: data.content }),
        ...(data.isPinned !== undefined && { isPinned: data.isPinned }),
      },
    });

    this.logger.log(`Updated bulletin id=${id}`);

    return { id: updated.id, message: 'Bulletin updated successfully' };
  }

  /**
   * Delete a bulletin
   */
  async delete(id: string, organizationId: string) {
    // Verify bulletin exists in this org
    const existing = await this.prisma.bulletin.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundException('Bulletin not found');
    }

    await this.prisma.bulletin.delete({ where: { id } });

    this.logger.log(`Deleted bulletin id=${id}`);

    return { message: 'Bulletin deleted successfully' };
  }
}
