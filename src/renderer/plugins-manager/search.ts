import { reactive, toRefs } from 'vue';
import listModeRunner from './listModeRenderer';

const searchManager = () => {
  const state = reactive({
    searchValue: '',
    placeholder: '',
    listModeItems: [],
  });

  // search Input operation
  const onSearch = (e) => {
    const value = e.target.value;
    state.searchValue = value;
  };

  const setSearchValue = (value: string) => {
    state.searchValue = value;
  };

  window.setSubInput = ({ placeholder }: { placeholder: string }) => {
    state.placeholder = placeholder;
  };
  window.removeSubInput = () => {
    state.placeholder = '';
  };
  window.setSubInputValue = ({ value }: { value: string }) => {
    state.searchValue = value;
  };

  window.getMainInputInfo = () => {
    return {
      value: state.searchValue,
      placeholder: state.placeholder,
    };
  };

  // mode: list 插件搜索
  const searchListModePlugin = async (value: string) => {
    const items = await listModeRunner.executeSearch(value);
    state.listModeItems = items;
    return items;
  };

  return {
    ...toRefs(state),
    onSearch,
    setSearchValue,
    searchListModePlugin,
  };
};

export default searchManager;
