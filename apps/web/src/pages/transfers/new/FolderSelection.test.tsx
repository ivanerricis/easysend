import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PickedFile } from '@/features/upload/types';
import { renderWithProviders } from '@/test/render';
import { Dropzone } from './Dropzone';
import { SelectedFiles, groupSelection } from './SelectedFiles';

const pick = (path: string, name: string, size = 3): PickedFile => ({
  file: new File([new Uint8Array(size)], name),
  path,
});

describe('groupSelection', () => {
  it('groups by top-level folder and keeps the original indexes', () => {
    const files = [pick('', 'a.txt'), pick('photos', 'b.jpg'), pick('photos/2030', 'c.jpg')];
    const { folders, loose } = groupSelection(files);
    expect(loose.map((l) => l.index)).toEqual([0]);
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatchObject({ name: 'photos', bytes: 6 });
    expect(folders[0]?.items.map((i) => i.index)).toEqual([1, 2]);
  });
});

describe('SelectedFiles', () => {
  it('shows a folder row with count and size, and removes the whole folder', () => {
    const onRemoveFolder = vi.fn();
    renderWithProviders(
      <SelectedFiles
        files={[
          pick('photos', 'a.jpg', 1024),
          pick('photos/2030', 'b.jpg', 1024),
          pick('', 'c.txt'),
        ]}
        onRemove={vi.fn()}
        onRemoveFolder={onRemoveFolder}
      />,
    );
    const list = screen.getByRole('list', { name: 'Selected files' });
    const folder = within(list).getByRole('button', { name: /^photos/ });
    expect(folder).toHaveTextContent('2 files');
    expect(folder).toHaveTextContent('2 KiB');
    expect(within(list).getByText('c.txt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove folder photos' }));
    expect(onRemoveFolder).toHaveBeenCalledWith('photos');
  });

  it('expands a folder to list its files with the sub-path and removes one of them', () => {
    const onRemove = vi.fn();
    renderWithProviders(
      <SelectedFiles
        files={[pick('photos', 'a.jpg'), pick('photos/2030', 'b.jpg')]}
        onRemove={onRemove}
        onRemoveFolder={vi.fn()}
      />,
    );
    expect(screen.queryByText('a.jpg')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^photos/ }));
    expect(screen.getByText('a.jpg')).toBeInTheDocument();
    expect(screen.getByText('2030/b.jpg')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove b.jpg' }));
    expect(onRemove).toHaveBeenCalledWith(1);
  });
});

describe('Dropzone', () => {
  it('offers a folder picker that reports files with their folder', () => {
    const onFiles = vi.fn();
    renderWithProviders(<Dropzone onFiles={onFiles} />);
    expect(screen.getByRole('button', { name: 'Choose folder' })).toBeVisible();
    const input = screen.getByTestId('folder-input');
    expect(input).toHaveAttribute('webkitdirectory');
    const file = new File(['x'], 'a.jpg');
    Object.defineProperty(file, 'webkitRelativePath', { value: 'photos/2030/a.jpg' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFiles).toHaveBeenCalledWith([{ file, path: 'photos/2030' }]);
  });

  it('reports plain files with an empty path', () => {
    const onFiles = vi.fn();
    renderWithProviders(<Dropzone onFiles={onFiles} />);
    const file = new File(['x'], 'a.txt');
    fireEvent.change(screen.getByTestId('file-input'), { target: { files: [file] } });
    expect(onFiles).toHaveBeenCalledWith([{ file, path: '' }]);
  });

  it('reads a dropped folder recursively', async () => {
    const onFiles = vi.fn();
    renderWithProviders(<Dropzone onFiles={onFiles} />);
    const inner = new File(['x'], 'a.txt');
    const entry = {
      isFile: false,
      isDirectory: true,
      name: 'docs',
      fullPath: '/docs',
      createReader: () => {
        let done = false;
        return {
          readEntries: (success: (entries: unknown[]) => void) => {
            if (done) return success([]);
            done = true;
            success([
              {
                isFile: true,
                isDirectory: false,
                name: 'a.txt',
                fullPath: '/docs/a.txt',
                file: (ok: (f: File) => void) => ok(inner),
              },
            ]);
          },
        };
      },
    };
    const zone = screen.getByRole('button', { name: 'Choose files' }).parentElement!.parentElement!;
    fireEvent.drop(zone, {
      dataTransfer: {
        types: ['Files'],
        files: [],
        items: [{ kind: 'file', webkitGetAsEntry: () => entry }],
      },
    });
    await vi.waitFor(() => expect(onFiles).toHaveBeenCalledWith([{ file: inner, path: 'docs' }]));
  });
});
