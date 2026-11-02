import type { Requester, RequestOptions } from '../core/request.js';
import type {
  CreateProjectRequest,
  Project,
  ProjectItemsAdded,
  ProjectItemsRemoved,
  ProjectItemsRequest,
  ProjectList,
  QueryOf,
  UpdateProjectRequest,
} from '../types.js';

export class Projects {
  constructor(private readonly request: Requester) {}

  /** `POST /projects`. */
  create(body: CreateProjectRequest, options?: RequestOptions): Promise<Project> {
    return this.request('createProject', { json: body, options });
  }

  /** `GET /projects`. */
  list(query: QueryOf<'listProjects'> = {}, options?: RequestOptions): Promise<ProjectList> {
    return this.request('listProjects', { query, options });
  }

  /** `GET /projects/{id}`. */
  get(id: string, options?: RequestOptions): Promise<Project> {
    return this.request('getProject', { path: { id }, options });
  }

  /** `PATCH /projects/{id}`. */
  update(id: string, body: UpdateProjectRequest, options?: RequestOptions): Promise<Project> {
    return this.request('updateProject', { path: { id }, json: body, options });
  }

  /** `DELETE /projects/{id}`. */
  delete(id: string, options?: RequestOptions): Promise<void> {
    return this.request('deleteProject', { path: { id }, options });
  }

  /** `POST /projects/{id}/items`. */
  addItems(
    id: string,
    body: ProjectItemsRequest,
    options?: RequestOptions,
  ): Promise<ProjectItemsAdded> {
    return this.request('addProjectItems', { path: { id }, json: body, options });
  }

  /** `POST /projects/{id}/items/remove`. */
  removeItems(
    id: string,
    body: ProjectItemsRequest,
    options?: RequestOptions,
  ): Promise<ProjectItemsRemoved> {
    return this.request('removeProjectItems', { path: { id }, json: body, options });
  }
}
